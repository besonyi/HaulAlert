import type { CentralDispatchOpenSearchRequest } from "@haulalert/adapter-central-dispatch";

import type { AuthenticatedCentralDispatchRequestExecutor } from "./central-dispatch-open-search-transport.js";
import { CentralDispatchOpenSearchTransport } from "./central-dispatch-open-search-transport.js";
import { CentralDispatchSessionClient } from "./central-dispatch-session-client.js";

const centralDispatchHost = "app.centraldispatch.com";

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

/**
 * Runs an Open Search request in the existing Central Dispatch page context.
 * `credentials: include` is evaluated inside Chrome, so HaulAlert never reads,
 * serializes, or stores browser cookies.
 */
export class CentralDispatchCdpRequestExecutor implements AuthenticatedCentralDispatchRequestExecutor {
  public constructor(private readonly runtime: ChromeDevToolsRuntime) {}

  public async execute(request: CentralDispatchOpenSearchRequest): Promise<unknown> {
    const target = await this.runtime.findCentralDispatchTarget();
    return this.runtime.evaluateJson(target, toFetchExpression(request));
  }
}

/** Composes the Central Dispatch CDP bridge into the shared session-client contract. */
export function createCentralDispatchCdpSessionClient(
  runtime: ChromeDevToolsRuntime
): CentralDispatchSessionClient {
  return new CentralDispatchSessionClient(
    new CentralDispatchOpenSearchTransport(new CentralDispatchCdpRequestExecutor(runtime))
  );
}

/** Uses Chrome's local DevTools endpoint, which defaults to 127.0.0.1:9222. */
export function createLocalCentralDispatchCdpSessionClient(endpoint?: string): CentralDispatchSessionClient {
  return createCentralDispatchCdpSessionClient(new LocalChromeDevToolsRuntime(endpoint));
}

/**
 * Minimal local-only Chrome DevTools Protocol client. The debugger endpoint is
 * restricted to a loopback HTTP address so a remote browser can never be used
 * as a provider session by accident.
 */
export class LocalChromeDevToolsRuntime implements ChromeDevToolsRuntime {
  private readonly endpoint: URL;

  public constructor(endpoint = "http://127.0.0.1:9222") {
    this.endpoint = new URL(endpoint);
    assertLoopbackEndpoint(this.endpoint);
  }

  public async findCentralDispatchTarget(): Promise<ChromeDevToolsTarget> {
    const response = await fetch(new URL("/json/list", this.endpoint));
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
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    try {
      await waitForSocketOpen(socket);
      const response = await sendChromeCommand(socket, {
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true }
      });
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

function toFetchExpression(request: CentralDispatchOpenSearchRequest): string {
  const url = JSON.stringify(request.url);
  const body = JSON.stringify(JSON.stringify(request.body));
  return [
    "fetch(", url, ", {",
    "method: 'POST',",
    "headers: { accept: 'application/json', 'content-type': 'application/json' },",
    "credentials: 'include',",
    "body: ", body,
    "}).then(async (response) => {",
    "const text = await response.text();",
    "if (!response.ok) throw new Error(`Central Dispatch returned HTTP ${response.status}`);",
    "JSON.parse(text);",
    "return text;",
    "})"
  ].join("");
}

function assertLoopbackEndpoint(endpoint: URL): void {
  if (endpoint.protocol !== "http:" || !isLoopbackHost(endpoint.hostname)) {
    throw new Error("Chrome DevTools endpoint must use loopback HTTP");
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

function waitForSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Could not connect to Chrome DevTools")), { once: true });
  });
}

function sendChromeCommand(socket: WebSocket, command: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data)) as unknown;
        const record = asRecord(message);
        if (record !== undefined && record.id === command.id) resolve(record);
      } catch (error) {
        reject(error);
      }
    });
    socket.addEventListener("error", () => reject(new Error("Chrome DevTools command failed")), { once: true });
    socket.send(JSON.stringify(command));
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
