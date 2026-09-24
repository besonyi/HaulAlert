import type { BrowserRuntime, BrowserRuntimeSnapshot, PersistentSearchTab } from "@haulalert/browser-runtime-core";
import type { CompiledProviderFilter } from "@haulalert/filter-compiler";

import type {
  ActivatedSearch,
  BrowserRuntimeOrchestrator,
  BrowserScanCoordinator,
  ProviderSearchActivation,
  RuntimeScanOutcome
} from "./index.js";

export interface BrowserRuntimeSnapshotStore {
  load(): Promise<BrowserRuntimeSnapshot>;
  save(snapshot: BrowserRuntimeSnapshot): Promise<void>;
}

/** Persists runtime metadata after every successful activation and scan batch. */
export class DurableBrowserRuntimeController {
  public constructor(
    private readonly runtime: BrowserRuntime,
    private readonly store: BrowserRuntimeSnapshotStore
  ) {}

  public async restore(): Promise<void> {
    this.runtime.restore(await this.store.load());
  }

  public async activate(
    orchestrator: BrowserRuntimeOrchestrator,
    filter: CompiledProviderFilter,
    providerSearchId?: string
  ): Promise<ActivatedSearch> {
    try {
      return await orchestrator.activateSearch(filter, providerSearchId);
    } finally {
      await this.store.save(this.runtime.snapshot());
    }
  }

  public async activateProviderSearch(
    orchestrator: BrowserRuntimeOrchestrator,
    search: ProviderSearchActivation,
    providerSearchId: string
  ): Promise<ActivatedSearch> {
    try {
      return await orchestrator.activateProviderSearch(search, providerSearchId);
    } finally {
      await this.store.save(this.runtime.snapshot());
    }
  }

  public async reconfigureProviderSearch(
    orchestrator: BrowserRuntimeOrchestrator,
    tab: PersistentSearchTab,
    search: ProviderSearchActivation
  ): Promise<PersistentSearchTab> {
    try {
      return await orchestrator.reconfigureSearch(tab, search);
    } finally {
      await this.store.save(this.runtime.snapshot());
    }
  }

  /** Closes tabs for durable searches that are no longer active in the database. */
  public async closeInactiveProviderSearchTabs(
    provider: PersistentSearchTab["provider"],
    activeProviderSearchIds: ReadonlySet<string>
  ): Promise<readonly PersistentSearchTab[]> {
    const closed: PersistentSearchTab[] = [];
    try {
      for (const tab of this.runtime.listTabs(provider)) {
        if (tab.status !== "closed" && tab.providerSearchId !== null && !activeProviderSearchIds.has(tab.providerSearchId)) {
          closed.push(this.runtime.closeTab(tab.id));
        }
      }
      return closed;
    } finally {
      await this.store.save(this.runtime.snapshot());
    }
  }

  public async processDue(
    coordinator: BrowserScanCoordinator,
    limit: number,
    now?: Date
  ): Promise<readonly RuntimeScanOutcome[]> {
    const outcomes = await coordinator.processDue(limit, now);
    await this.store.save(this.runtime.snapshot());
    return outcomes;
  }
}
