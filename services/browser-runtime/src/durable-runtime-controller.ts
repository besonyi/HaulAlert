import type { BrowserRuntime, BrowserRuntimeSnapshot } from "@haulalert/browser-runtime-core";
import type { CompiledProviderFilter } from "@haulalert/filter-compiler";

import type { ActivatedSearch, BrowserRuntimeOrchestrator, BrowserScanCoordinator, RuntimeScanOutcome } from "./index.js";

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
    const activated = await orchestrator.activateSearch(filter, providerSearchId);
    await this.store.save(this.runtime.snapshot());
    return activated;
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
