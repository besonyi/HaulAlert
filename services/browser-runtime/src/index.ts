import {
  BrowserRuntime,
  ScanScheduler,
  type PersistentSearchTab,
  type SearchTabReservation
} from "@haulalert/browser-runtime-core";
import type { CompiledProviderFilter, SourceFilter } from "@haulalert/filter-compiler";
import type { NewLoadScanResult, OrderedLoadScan } from "@haulalert/new-load-detector";

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

export interface ProviderSearchScanner {
  scan(input: {
    readonly sessionId: string;
    readonly tabId: string;
    readonly provider: PersistentSearchTab["provider"];
    readonly sourceFilterHash: string;
  }): Promise<OrderedLoadScan>;
}

export interface ScanProcessor {
  process(scan: OrderedLoadScan, now?: Date): Promise<{ readonly scan: NewLoadScanResult }>;
}

export type RuntimeScanOutcome =
  | { readonly status: "processed"; readonly tab: PersistentSearchTab; readonly result: NewLoadScanResult }
  | { readonly status: "failed"; readonly tab: PersistentSearchTab; readonly error: Error };

/**
 * Executes due provider searches serially, preserves the tab scheduling signal,
 * and sends each accepted scan into the durable ingestion boundary.
 */
export class BrowserScanCoordinator {
  public constructor(
    private readonly runtime: BrowserRuntime,
    private readonly scheduler: ScanScheduler,
    private readonly scanner: ProviderSearchScanner,
    private readonly processor: ScanProcessor
  ) {}

  public async processDue(limit: number, now: Date = new Date()): Promise<readonly RuntimeScanOutcome[]> {
    const outcomes: RuntimeScanOutcome[] = [];
    for (const scheduled of this.scheduler.selectDue(this.runtime.listScannableTabs(), now, limit)) {
      const { tab } = scheduled;
      try {
        const scan = await this.scanner.scan({
          sessionId: tab.sessionId,
          tabId: tab.id,
          provider: tab.provider,
          sourceFilterHash: tab.sourceFilterHash
        });
        assertProviderRows(scan, tab);
        const result = await this.processor.process(scan, now);
        const updatedTab = this.runtime.recordScan(tab.id);
        this.scheduler.recordOutcome(tab.id, {
          newLoadCount: result.scan.newLoads.length,
          overflowRisk: result.scan.overflowRisk
        });
        outcomes.push({ status: "processed", tab: updatedTab, result: result.scan });
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error("Unknown provider scan failure");
        this.scheduler.forget(tab.id);
        outcomes.push({ status: "failed", tab: this.runtime.markTabDegraded(tab.id), error });
      }
    }
    return outcomes;
  }
}

function assertProviderRows(scan: OrderedLoadScan, tab: PersistentSearchTab): void {
  if (scan.loads.some((load) => load.provider !== tab.provider)) {
    throw new Error(`Provider scan for ${tab.provider} returned rows from another provider`);
  }
}
