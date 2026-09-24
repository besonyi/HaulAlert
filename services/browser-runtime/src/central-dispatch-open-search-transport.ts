import {
  buildCentralDispatchOpenSearchRequest,
  type CentralDispatchOpenSearchRequest
} from "@haulalert/adapter-central-dispatch";

import type { CentralDispatchSessionTransport } from "./central-dispatch-session-client.js";
import type { ProviderSearchConfiguration, ProviderSearchPage, ProviderSearchScan } from "./index.js";

/**
 * Executes a request inside an already-authenticated provider browser context.
 * Implementations may use an Electron session, an extension bridge, or a
 * managed browser worker; they must never expose cookies or authorization data.
 */
export interface AuthenticatedCentralDispatchRequestExecutor {
  execute(request: CentralDispatchOpenSearchRequest): Promise<unknown>;
}

/**
 * Converts a provider-neutral filter into Central Dispatch's open-search call,
 * then evaluates that call only through the authenticated browser executor.
 */
export class CentralDispatchOpenSearchTransport implements CentralDispatchSessionTransport {
  private readonly configuredRequests = new Map<string, CentralDispatchOpenSearchRequest>();

  public constructor(
    private readonly executor: AuthenticatedCentralDispatchRequestExecutor,
    private readonly pageSize = 250
  ) {}

  public async configureSearch(input: Omit<ProviderSearchConfiguration, "provider">): Promise<void> {
    this.configuredRequests.set(
      toSearchKey(input.sessionId, input.tabId),
      buildCentralDispatchOpenSearchRequest(input.sourceFilter, { limit: this.pageSize })
    );
  }

  public async fetchSearch(input: Omit<ProviderSearchScan, "provider">): Promise<ProviderSearchPage> {
    const request = this.configuredRequests.get(toSearchKey(input.sessionId, input.tabId));
    if (request === undefined) {
      throw new Error(`Central Dispatch request is not configured for tab ${input.tabId}`);
    }

    const payload = await this.executor.execute(request);
    return { payload, isTruncated: isTruncatedCentralDispatchPage(payload, request.body.limit) };
  }
}

function isTruncatedCentralDispatchPage(payload: unknown, limit: number): boolean {
  const root = asRecord(payload);
  const items = Array.isArray(root?.items) ? root.items : [];
  const total = firstFiniteNumber(
    root?.total,
    root?.totalCount,
    root?.totalItems,
    asRecord(root?.pagination)?.total,
    asRecord(root?.page)?.total
  );
  return total === null ? items.length >= limit : total > items.length;
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function toSearchKey(sessionId: string, tabId: string): string {
  return JSON.stringify([sessionId, tabId]);
}
