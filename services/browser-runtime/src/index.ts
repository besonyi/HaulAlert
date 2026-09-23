import {
  BrowserRuntime,
  type PersistentSearchTab,
  type SearchTabReservation
} from "@haulalert/browser-runtime-core";
import type { CompiledProviderFilter, SourceFilter } from "@haulalert/filter-compiler";

export interface ProviderSearchDriver {
  configureSearch(input: {
    readonly sessionId: string;
    readonly tabId: string;
    readonly provider: CompiledProviderFilter["provider"];
    readonly sourceFilter: SourceFilter;
  }): Promise<void>;
}

export interface ActivatedSearch {
  readonly tab: PersistentSearchTab;
  readonly reused: boolean;
}

/**
 * Connects runtime allocation to a future Playwright/browser implementation.
 * It does not know provider selectors; adapters own those details.
 */
export class BrowserRuntimeOrchestrator {
  public constructor(
    private readonly runtime: BrowserRuntime,
    private readonly driver: ProviderSearchDriver
  ) {}

  public async activateSearch(filter: CompiledProviderFilter): Promise<ActivatedSearch> {
    const reservation = this.runtime.reserveSearchTab({
      provider: filter.provider,
      sourceFilterHash: filter.sourceFilterHash
    });

    if (reservation.reused) {
      return reservation;
    }

    return this.configureNewSearch(reservation, filter);
  }

  private async configureNewSearch(
    reservation: SearchTabReservation,
    filter: CompiledProviderFilter
  ): Promise<ActivatedSearch> {
    try {
      await this.driver.configureSearch({
        sessionId: reservation.tab.sessionId,
        tabId: reservation.tab.id,
        provider: filter.provider,
        sourceFilter: filter.sourceFilter
      });

      return {
        tab: this.runtime.markTabReady(reservation.tab.id),
        reused: false
      };
    } catch (error) {
      this.runtime.closeTab(reservation.tab.id);
      throw error;
    }
  }
}
