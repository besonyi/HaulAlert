import {
  BrowserRuntime,
  ScanScheduler,
  type PersistentSearchTab,
  type SearchTabReservation
} from "@haulalert/browser-runtime-core";
import { normalizeCentralDispatchSearchResponse } from "@haulalert/adapter-central-dispatch";
import { normalizeShipCarsSearchResponse } from "@haulalert/adapter-shipcars";
import { normalizeSuperDispatchSearchResponse } from "@haulalert/adapter-super-dispatch";
import type { CompiledProviderFilter, SourceFilter } from "@haulalert/filter-compiler";
import type { NormalizedLoad } from "@haulalert/load-model";
import type { NewLoadScanResult, OrderedLoadScan } from "@haulalert/new-load-detector";

export { PostgresBrowserRuntimeStateStore, type RuntimeSqlExecutor } from "./postgres-runtime-state-store.js";
export { DurableBrowserRuntimeController, type BrowserRuntimeSnapshotStore } from "./durable-runtime-controller.js";

export interface ProviderSearchConfiguration {
  readonly sessionId: string;
  readonly tabId: string;
  readonly provider: CompiledProviderFilter["provider"];
  readonly sourceFilter: SourceFilter;
}

export interface ProviderSearchDriver {
  configureSearch(input: ProviderSearchConfiguration): Promise<void>;
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

  public async activateSearch(
    filter: CompiledProviderFilter,
    providerSearchId?: string
  ): Promise<ActivatedSearch> {
    const reservation = this.runtime.reserveSearchTab({
      provider: filter.provider,
      sourceFilterHash: filter.sourceFilterHash,
      ...(providerSearchId === undefined ? {} : { providerSearchId })
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

export interface ProviderSearchScan {
  readonly sessionId: string;
  readonly tabId: string;
  readonly provider: PersistentSearchTab["provider"];
  readonly sourceFilterHash: string;
}

export interface ProviderSearchScanner {
  scan(input: ProviderSearchScan): Promise<OrderedLoadScan>;
}

/** A provider adapter operates only within its already-authenticated session. */
export interface SessionBackedProviderAdapter {
  readonly provider: CompiledProviderFilter["provider"];
  configureSearch(input: Omit<ProviderSearchConfiguration, "provider">): Promise<void>;
  scan(input: Omit<ProviderSearchScan, "provider">): Promise<OrderedLoadScan>;
}

/** A raw provider response plus the source's indication that its window was capped. */
export interface ProviderSearchPage {
  readonly payload: unknown;
  readonly isTruncated: boolean;
}

/** Opaque browser/session transport; provider cookies and credentials stay behind it. */
export interface ProviderSessionSearchClient {
  configureSearch(input: Omit<ProviderSearchConfiguration, "provider">): Promise<void>;
  fetchSearch(input: Omit<ProviderSearchScan, "provider">): Promise<ProviderSearchPage>;
}

export type ProviderResponseNormalizer = (payload: unknown) => readonly NormalizedLoad[];

/**
 * Adapts a provider-specific raw response normalizer to the shared scan
 * contract. Browser implementations own session I/O; adapter packages own
 * response interpretation, keeping credentials out of both layers.
 */
export class NormalizingSessionProviderAdapter implements SessionBackedProviderAdapter {
  public constructor(
    public readonly provider: CompiledProviderFilter["provider"],
    private readonly client: ProviderSessionSearchClient,
    private readonly normalize: ProviderResponseNormalizer
  ) {}

  public async configureSearch(input: Omit<ProviderSearchConfiguration, "provider">): Promise<void> {
    await this.client.configureSearch(input);
  }

  public async scan(input: Omit<ProviderSearchScan, "provider">): Promise<OrderedLoadScan> {
    const page = await this.client.fetchSearch(input);
    return {
      searchId: `${this.provider}:${input.sourceFilterHash}`,
      loads: this.normalize(page.payload),
      isTruncated: page.isTruncated
    };
  }
}

export class UnknownProviderAdapterError extends Error {
  public constructor(provider: CompiledProviderFilter["provider"]) {
    super(`No session-backed adapter is configured for provider: ${provider}`);
    this.name = "UnknownProviderAdapterError";
  }
}

/**
 * HaulFlow-style boundary between session ownership and provider adapters.
 * Browser/session code supplies opaque tab references; adapters receive only
 * the operations for their own provider and never expose session material.
 */
export class SessionSearchGateway implements ProviderSearchDriver, ProviderSearchScanner {
  private readonly adapters = new Map<CompiledProviderFilter["provider"], SessionBackedProviderAdapter>();

  public constructor(adapters: readonly SessionBackedProviderAdapter[]) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.provider)) {
        throw new Error(`Duplicate session-backed adapter for provider: ${adapter.provider}`);
      }
      this.adapters.set(adapter.provider, adapter);
    }
  }

  public async configureSearch(input: ProviderSearchConfiguration): Promise<void> {
    const { provider, ...configuration } = input;
    await this.getAdapter(provider).configureSearch(configuration);
  }

  public async scan(input: ProviderSearchScan): Promise<OrderedLoadScan> {
    const { provider, ...scan } = input;
    return this.getAdapter(provider).scan(scan);
  }

  private getAdapter(provider: CompiledProviderFilter["provider"]): SessionBackedProviderAdapter {
    const adapter = this.adapters.get(provider);
    if (adapter === undefined) throw new UnknownProviderAdapterError(provider);
    return adapter;
  }
}

/** One opaque authenticated-session port per supported provider. */
export type ProviderSessionSearchClients = Readonly<Record<
  CompiledProviderFilter["provider"],
  ProviderSessionSearchClient
>>;

/**
 * Wires provider-owned response parsers into the session gateway. This is the
 * only runtime composition layer that imports all provider adapters.
 */
export function createHaulAlertSessionAdapters(
  clients: ProviderSessionSearchClients
): readonly SessionBackedProviderAdapter[] {
  return [
    new NormalizingSessionProviderAdapter(
      "central-dispatch",
      clients["central-dispatch"],
      normalizeCentralDispatchSearchResponse
    ),
    new NormalizingSessionProviderAdapter(
      "super-dispatch",
      clients["super-dispatch"],
      normalizeSuperDispatchSearchResponse
    ),
    new NormalizingSessionProviderAdapter(
      "shipcars",
      clients.shipcars,
      normalizeShipCarsSearchResponse
    )
  ];
}

export function createHaulAlertSessionSearchGateway(
  clients: ProviderSessionSearchClients
): SessionSearchGateway {
  return new SessionSearchGateway(createHaulAlertSessionAdapters(clients));
}

export interface ScanProcessor {
  process(scan: OrderedLoadScan, now?: Date): Promise<{ readonly scan: NewLoadScanResult }>;
}

export interface ScanHistoryRecorder {
  record(input: CompletedProviderScan, result: NewLoadScanResult): Promise<void>;
}

export interface CompletedProviderScan {
  readonly providerSearchId: string;
  readonly scan: OrderedLoadScan;
  readonly startedAt: Date;
  readonly completedAt: Date;
}

export interface HistoryAwareScanProcessor extends ScanProcessor {
  processCompletedScan(
    completedScan: CompletedProviderScan,
    history: ScanHistoryRecorder
  ): Promise<{ readonly scan: NewLoadScanResult; readonly historyError?: Error }>;
}

export interface BrowserScanCoordinatorOptions {
  readonly history?: ScanHistoryRecorder;
  readonly clock?: () => Date;
}

export type RuntimeScanOutcome =
  | {
      readonly status: "processed";
      readonly tab: PersistentSearchTab;
      readonly result: NewLoadScanResult;
      readonly historyError?: Error;
    }
  | { readonly status: "failed"; readonly tab: PersistentSearchTab; readonly error: Error };

/**
 * Executes due provider searches serially, preserves the tab scheduling signal,
 * and sends each accepted scan into the durable ingestion boundary.
 */
export class BrowserScanCoordinator {
  private readonly history: ScanHistoryRecorder | undefined;
  private readonly clock: () => Date;

  public constructor(
    private readonly runtime: BrowserRuntime,
    private readonly scheduler: ScanScheduler,
    private readonly scanner: ProviderSearchScanner,
    private readonly processor: ScanProcessor,
    options: BrowserScanCoordinatorOptions = {}
  ) {
    if (options.history !== undefined && !isHistoryAware(processor)) {
      throw new Error("A scan history recorder requires a history-aware scan processor");
    }
    this.history = options.history;
    this.clock = options.clock ?? (() => new Date());
  }

  public async processDue(limit: number, now: Date = new Date()): Promise<readonly RuntimeScanOutcome[]> {
    const outcomes: RuntimeScanOutcome[] = [];
    for (const scheduled of this.scheduler.selectDue(this.runtime.listScannableTabs(), now, limit)) {
      const { tab } = scheduled;
      try {
        const startedAt = this.clock();
        const scan = await this.scanner.scan({
          sessionId: tab.sessionId,
          tabId: tab.id,
          provider: tab.provider,
          sourceFilterHash: tab.sourceFilterHash
        });
        assertProviderRows(scan, tab);
        const result = await this.processScan(tab, scan, startedAt, this.clock(), now);
        const updatedTab = this.runtime.recordScan(tab.id);
        this.scheduler.recordOutcome(tab.id, {
          newLoadCount: result.scan.newLoads.length,
          overflowRisk: result.scan.overflowRisk
        });
        outcomes.push({
          status: "processed",
          tab: updatedTab,
          result: result.scan,
          ...(result.historyError === undefined ? {} : { historyError: result.historyError })
        });
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error("Unknown provider scan failure");
        this.scheduler.forget(tab.id);
        outcomes.push({ status: "failed", tab: this.runtime.markTabDegraded(tab.id), error });
      }
    }
    return outcomes;
  }

  private async processScan(
    tab: PersistentSearchTab,
    scan: OrderedLoadScan,
    startedAt: Date,
    completedAt: Date,
    now: Date
  ): Promise<{ readonly scan: NewLoadScanResult; readonly historyError?: Error }> {
    if (this.history === undefined) return this.processor.process(scan, now);
    if (tab.providerSearchId === null) {
      return {
        ...(await this.processor.process(scan, now)),
        historyError: new Error(`Search tab ${tab.id} has no durable provider search ID`)
      };
    }
    const processor = this.processor as HistoryAwareScanProcessor;
    return processor.processCompletedScan({ providerSearchId: tab.providerSearchId, scan, startedAt, completedAt }, this.history);
  }
}

function assertProviderRows(scan: OrderedLoadScan, tab: PersistentSearchTab): void {
  if (scan.loads.some((load) => load.provider !== tab.provider)) {
    throw new Error(`Provider scan for ${tab.provider} returned rows from another provider`);
  }
}

function isHistoryAware(processor: ScanProcessor): processor is HistoryAwareScanProcessor {
  return "processCompletedScan" in processor && typeof processor.processCompletedScan === "function";
}
