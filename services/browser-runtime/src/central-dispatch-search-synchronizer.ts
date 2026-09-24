import type { BrowserRuntimeOrchestrator } from "./index.js";
import type { DurableBrowserRuntimeController } from "./durable-runtime-controller.js";
import type { PostgresProviderSearchSource } from "./postgres-provider-search-source.js";

/** Keeps browser tabs aligned with the active Central Dispatch searches in PostgreSQL. */
export class CentralDispatchSearchSynchronizer {
  private readonly configuredSearchIds = new Set<string>();

  public constructor(
    private readonly source: PostgresProviderSearchSource,
    private readonly durableRuntime: DurableBrowserRuntimeController,
    private readonly orchestrator: BrowserRuntimeOrchestrator
  ) {}

  public async synchronize(): Promise<void> {
    const searches = await this.source.listActiveCentralDispatchSearches();
    for (const search of searches) {
      const activated = await this.durableRuntime.activateProviderSearch(this.orchestrator, search, search.id);
      if (activated.reused && !this.configuredSearchIds.has(search.id)) {
        await this.durableRuntime.reconfigureProviderSearch(this.orchestrator, activated.tab, search);
      }
      this.configuredSearchIds.add(search.id);
    }
    await this.durableRuntime.closeInactiveProviderSearchTabs(
      "central-dispatch",
      new Set(searches.map((search) => search.id))
    );
  }
}
