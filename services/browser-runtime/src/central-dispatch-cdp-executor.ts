import {
  centralDispatchOpenSearchUrl,
  type CentralDispatchOpenSearchRequest
} from "@haulalert/adapter-central-dispatch";

import type { AuthenticatedCentralDispatchRequestExecutor } from "./central-dispatch-open-search-transport.js";
import { CentralDispatchOpenSearchTransport } from "./central-dispatch-open-search-transport.js";
import { CentralDispatchSessionClient } from "./central-dispatch-session-client.js";

const centralDispatchHost = "app.centraldispatch.com";
const defaultRequestTimeoutMs = 15_000;
const maxProviderResponseCharacters = 2 * 1024 * 1024;

export interface ChromeDevToolsTarget {
  readonly id: string;
  readonly type: string;
  readonly url: string;
  readonly webSocketDebuggerUrl: string;
}

export interface ChromeDevToolsRuntime {
  findCentralDispatchTarget(): Promise<ChromeDevToolsTarget>;
  evaluateJson(target: ChromeDevToolsTarget, expression: string): Promise<unknown>;
}

/** Raised when the local browser does not expose an authenticated Central Dispatch tab. */
export class CentralDispatchTabNotFoundError extends Error {
  public constructor() {
    super("No authenticated Central Dispatch page is available through the local browser debugger");
    this.name = "CentralDispatchTabNotFoundError";
  }
}

/** Raised when the local browser or the provider page does not answer in time. */
export class CentralDispatchRequestTimeoutError extends Error {
  public constructor(readonly timeoutMs: number) {
    super(`Central Dispatch request timed out after ${timeoutMs}ms`);
    this.name = "CentralDispatchRequestTimeoutError";
  }
}

/**
 * Runs an Open Search request in the existing Central Dispatch page context.
 * `credentials: include` is evaluated inside Chrome, so HaulAlert never reads,
 * serializes, or stores browser cookies.
 */
export class CentralDispatchCdpRequestExecutor implements AuthenticatedCentralDispatchRequestExecutor {
  public constructor(
    private readonly runtime: ChromeDevToolsRuntime,
    private readonly requestTimeoutMs: number = defaultRequestTimeoutMs
  ) {
    assertRequestTimeout(requestTimeoutMs);
  }

  public async execute(request: CentralDispatchOpenSearchRequest): Promise<unknown> {
    assertCentralDispatchOpenSearchRequest(request);
    const target = await withTimeout(this.runtime.findCentralDispatchTarget(), this.requestTimeoutMs);
    return withTimeout(this.runtime.evaluateJson(target, toFetchExpression(request, this.requestTimeoutMs)), this.requestTimeoutMs);
  }
}

/** Keeps authenticated browser requests constrained to the verified provider endpoint. */
function assertCentralDispatchOpenSearchRequest(request: CentralDispatchOpenSearchRequest): void {
  if (request.method !== "POST" || request.url !== centralDispatchOpenSearchUrl) {
    throw new Error("Central Dispatch browser request must use the approved Open Search endpoint");
  }
}

/** Composes the Central Dispatch CDP bridge into the shared session-client contract. */
export function createCentralDispatchCdpSessionClient(
  runtime: ChromeDevToolsRuntime,
  requestTimeoutMs?: number
): CentralDispatchSessionClient {
  return new CentralDispatchSessionClient(
    new CentralDispatchOpenSearchTransport(new CentralDispatchCdpRequestExecutor(runtime, requestTimeoutMs))
  );
}

/** Uses Chrome's local DevTools endpoint, which defaults to 127.0.0.1:9222. */
export function createLocalCentralDispatchCdpSessionClient(
  endpoint?: string,
  requestTimeoutMs?: number
): CentralDispatchSessionClient {
  return createCentralDispatchCdpSessionClient(
    new LocalChromeDevToolsRuntime(endpoint, requestTimeoutMs),
    requestTimeoutMs
  );
}

/**
 * Minimal local-only Chrome DevTools Protocol client. The debugger endpoint is
 * restricted to a loopback HTTP address so a remote browser can never be used
 * as a provider session by accident.
 */
export class LocalChromeDevToolsRuntime implements ChromeDevToolsRuntime {
  private readonly endpoint: URL;

  public constructor(
    endpoint = "http://127.0.0.1:9222",
    private readonly requestTimeoutMs: number = defaultRequestTimeoutMs
  ) {
    this.endpoint = new URL(endpoint);
    assertLocalChromeDevToolsEndpoint(this.endpoint);
    assertRequestTimeout(requestTimeoutMs);
  }

  public async findCentralDispatchTarget(): Promise<ChromeDevToolsTarget> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.requestTimeoutMs);
    let response: Response;
    try {
      response = await fetch(new URL("/json/list", this.endpoint), { signal: abortController.signal });
    } catch (error: unknown) {
      if (abortController.signal.aborted) throw new CentralDispatchRequestTimeoutError(this.requestTimeoutMs);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new Error(`Chrome DevTools target listing returned HTTP ${response.status}`);
    }
    const values = await response.json() as unknown;
    const targets = Array.isArray(values) ? values.flatMap(parseTarget) : [];
    const target = targets.find((candidate) => candidate.type === "page" && isCentralDispatchUrl(candidate.url));
    if (target === undefined) throw new CentralDispatchTabNotFoundError();
    return target;
  }

  public async evaluateJson(target: ChromeDevToolsTarget, expression: string): Promise<unknown> {
    assertLocalChromeDevToolsWebSocketEndpoint(target.webSocketDebuggerUrl);
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    try {
      await waitForSocketOpen(socket, this.requestTimeoutMs);
      const response = await sendChromeCommand(socket, {
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true }
      }, this.requestTimeoutMs);
      const failure = asRecord(response.error);
      if (failure !== undefined) {
        throw new Error(`Chrome DevTools evaluation failed: ${stringValue(failure.message) ?? "unknown error"}`);
      }
      const exception = asRecord(asRecord(response.result)?.exceptionDetails);
      if (exception !== undefined) {
        throw new Error(`Central Dispatch page request failed: ${stringValue(exception.text) ?? "unknown error"}`);
      }
      const remoteObject = asRecord(asRecord(response.result)?.result);
      const value = stringValue(remoteObject?.value);
      if (value === null) throw new Error("Central Dispatch page did not return a JSON response");
      return JSON.parse(value) as unknown;
    } finally {
      socket.close();
    }
  }
}

function toFetchExpression(request: CentralDispatchOpenSearchRequest, requestTimeoutMs: number): string {
  const url = JSON.stringify(request.url);
  const body = JSON.stringify(JSON.stringify(request.body));
  return [
    "(() => { const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), ", String(requestTimeoutMs), "); return fetch(", url, ", {",
    "method: 'POST',",
    "headers: { accept: 'application/json', 'content-type': 'application/json' },",
    "credentials: 'include',",
    "signal: controller.signal,",
    "body: ", body,
    "}).then(async (response) => {",
    "const text = await response.text();",
    "if (!response.ok) throw new Error(`Central Dispatch returned HTTP ${response.status}`);",
    "if (text.length > ", String(maxProviderResponseCharacters), ") throw new Error('Central Dispatch response exceeded 2 MiB');",
    "JSON.parse(text);",
    "return text;",
    "}).finally(() => clearTimeout(timeout)); })()"
  ].join("");
}

/** Ensures Chrome DevTools stays local and cannot receive embedded credentials. */
export function assertLocalChromeDevToolsEndpoint(endpoint: URL): void {
  if (
    endpoint.protocol !== "http:" ||
    endpoint.username.length > 0 ||
    endpoint.password.length > 0 ||
    !isLoopbackHost(endpoint.hostname)
  ) {
    throw new Error("Chrome DevTools endpoint must use credential-free loopback HTTP");
  }
}

/** Prevents a target-list response from redirecting the bridge to another host. */
export function assertLocalChromeDevToolsWebSocketEndpoint(value: string): void {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("Chrome DevTools WebSocket endpoint must be a valid URL");
  }
  if (
    endpoint.protocol !== "ws:" ||
    endpoint.username.length > 0 ||
    endpoint.password.length > 0 ||
    !isLoopbackHost(endpoint.hostname)
  ) {
    throw new Error("Chrome DevTools WebSocket endpoint must use credential-free loopback WS");
  }
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

function isCentralDispatchUrl(value: string): boolean {
  try {
    return new URL(value).hostname === centralDispatchHost;
  } catch {
    return false;
  }
}

function parseTarget(value: unknown): ChromeDevToolsTarget[] {
  const target = asRecord(value);
  const id = stringValue(target?.id);
  const type = stringValue(target?.type);
  const url = stringValue(target?.url);
  const webSocketDebuggerUrl = stringValue(target?.webSocketDebuggerUrl);
  return id === null || type === null || url === null || webSocketDebuggerUrl === null
    ? []
    : [{ id, type, url, webSocketDebuggerUrl }];
}

function waitForSocketOpen(socket: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new CentralDispatchRequestTimeoutError(timeoutMs)), timeoutMs);
    socket.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Could not connect to Chrome DevTools")); }, { once: true });
  });
}

function sendChromeCommand(
  socket: WebSocket,
  command: Record<string, unknown>,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new CentralDispatchRequestTimeoutError(timeoutMs)), timeoutMs);
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data)) as unknown;
        const record = asRecord(message);
        if (record !== undefined && record.id === command.id) { clearTimeout(timeout); resolve(record); }
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
    socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Chrome DevTools command failed")); }, { once: true });
    socket.send(JSON.stringify(command));
  });
}

function assertRequestTimeout(value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("Central Dispatch request timeout must be a positive integer");
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new CentralDispatchRequestTimeoutError(timeoutMs)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
