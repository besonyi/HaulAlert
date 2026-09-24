import { createSourceFilterHash, type SourceFilter } from "@haulalert/filter-compiler";

import type {
  ProviderSearchConfiguration,
  ProviderSearchPage,
  ProviderSearchScan,
  ProviderSessionSearchClient
} from "./index.js";

/**
 * The provider-specific browser bridge. Its implementation runs in an already
 * authenticated Central Dispatch browser context; it never returns credentials
 * or session material to HaulAlert.
 */
export interface CentralDispatchSessionTransport {
  configureSearch(input: Omit<ProviderSearchConfiguration, "provider">): Promise<void>;
  fetchSearch(input: Omit<ProviderSearchScan, "provider">): Promise<ProviderSearchPage>;
}

export class CentralDispatchSearchNotConfiguredError extends Error {
  public constructor(sessionId: string, tabId: string) {
    super(`Central Dispatch search is not configured for session ${sessionId}, tab ${tabId}`);
    this.name = "CentralDispatchSearchNotConfiguredError";
  }
}

export class CentralDispatchStaleSearchError extends Error {
  public constructor(sessionId: string, tabId: string) {
    super(`Central Dispatch search filter changed for session ${sessionId}, tab ${tabId}`);
    this.name = "CentralDispatchStaleSearchError";
  }
}

/**
 * Session client for Central Dispatch. It makes a browser transport usable by
 * the shared runtime while guaranteeing that a scan cannot be attributed to a
 * different filter after a user or provider changes the active search.
 */
export class CentralDispatchSessionClient implements ProviderSessionSearchClient {
  private readonly configuredSearches = new Map<string, string>();

  public constructor(private readonly transport: CentralDispatchSessionTransport) {}

  public async configureSearch(input: Omit<ProviderSearchConfiguration, "provider">): Promise<void> {
    const key = toSearchKey(input.sessionId, input.tabId);
    this.configuredSearches.delete(key);
    await this.transport.configureSearch(input);
    this.configuredSearches.set(key, createSourceFilterHash("central-dispatch", input.sourceFilter));
  }

  public async fetchSearch(input: Omit<ProviderSearchScan, "provider">): Promise<ProviderSearchPage> {
    const configuredFilterHash = this.configuredSearches.get(toSearchKey(input.sessionId, input.tabId));
    if (configuredFilterHash === undefined) {
      throw new CentralDispatchSearchNotConfiguredError(input.sessionId, input.tabId);
    }
    if (configuredFilterHash !== input.sourceFilterHash) {
      throw new CentralDispatchStaleSearchError(input.sessionId, input.tabId);
    }
    return this.transport.fetchSearch(input);
  }
}

function toSearchKey(sessionId: string, tabId: string): string {
  return JSON.stringify([sessionId, tabId]);
}

export type { SourceFilter };
