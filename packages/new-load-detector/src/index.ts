import { getGlobalLoadKey, type NormalizedLoad } from "@haulalert/load-model";

export interface SeenLoadStore {
  has(loadKey: string): boolean;
  add(loadKey: string): void;
  isSearchInitialized(searchId: string): boolean;
  markSearchInitialized(searchId: string): void;
}

/** In-memory implementation for local runtime and deterministic tests. */
export class InMemorySeenLoadStore implements SeenLoadStore {
  private readonly loadKeys = new Set<string>();
  private readonly initializedSearches = new Set<string>();

  public has(loadKey: string): boolean {
    return this.loadKeys.has(loadKey);
  }

  public add(loadKey: string): void {
    this.loadKeys.add(loadKey);
  }

  public isSearchInitialized(searchId: string): boolean {
    return this.initializedSearches.has(searchId);
  }

  public markSearchInitialized(searchId: string): void {
    this.initializedSearches.add(searchId);
  }
}

export interface OrderedLoadScan {
  /** Stable source-search identity, usually the provider plus source_filter_hash. */
  readonly searchId: string;
  /** Results ordered from newest/highest-priority candidate to oldest. */
  readonly loads: readonly NormalizedLoad[];
  /** True when the provider result window is capped and may omit older rows. */
  readonly isTruncated: boolean;
}

export interface NewLoadScanResult {
  readonly newLoads: readonly NormalizedLoad[];
  readonly seeded: boolean;
  readonly boundaryFound: boolean;
  /**
   * The detector could not find a previously seen row inside a capped result
   * window. The scheduler should accelerate or split this search bucket.
   */
  readonly overflowRisk: boolean;
}

/**
 * Converts a provider's sorted top rows into a global new-load stream.
 * It is intentionally provider-agnostic: Central/Super/Ship.Cars sorting is
 * handled before this boundary by their HaulFlow-backed search plans.
 */
export class NewLoadDetector {
  public constructor(private readonly seenLoads: SeenLoadStore) {}

  public inspect(scan: OrderedLoadScan): NewLoadScanResult {
    if (!this.seenLoads.isSearchInitialized(scan.searchId)) {
      for (const load of scan.loads) {
        this.seenLoads.add(getGlobalLoadKey(load));
      }
      this.seenLoads.markSearchInitialized(scan.searchId);

      return {
        newLoads: [],
        seeded: true,
        boundaryFound: false,
        overflowRisk: false
      };
    }

    const newLoads: NormalizedLoad[] = [];
    let boundaryFound = false;

    for (const load of scan.loads) {
      const loadKey = getGlobalLoadKey(load);
      if (this.seenLoads.has(loadKey)) {
        boundaryFound = true;
        break;
      }

      this.seenLoads.add(loadKey);
      newLoads.push(load);
    }

    return {
      newLoads,
      seeded: false,
      boundaryFound,
      overflowRisk: scan.isTruncated && !boundaryFound
    };
  }
}

export interface AsyncSeenLoadStore {
  has(searchId: string, loadKey: string): Promise<boolean>;
  add(searchId: string, loadKey: string): Promise<void>;
  isSearchInitialized(searchId: string): Promise<boolean>;
  markSearchInitialized(searchId: string): Promise<void>;
}

/**
 * Durable-friendly detector. Its new rows are acknowledged only after the
 * caller has durably processed them, allowing a restart to safely replay an
 * unacknowledged top window through the idempotent ingestion outbox.
 */
export class AsyncNewLoadDetector {
  public constructor(private readonly seenLoads: AsyncSeenLoadStore) {}

  public async inspect(scan: OrderedLoadScan): Promise<NewLoadScanResult> {
    if (!await this.seenLoads.isSearchInitialized(scan.searchId)) {
      for (const load of scan.loads) await this.seenLoads.add(scan.searchId, getGlobalLoadKey(load));
      await this.seenLoads.markSearchInitialized(scan.searchId);
      return { newLoads: [], seeded: true, boundaryFound: false, overflowRisk: false };
    }

    const newLoads: NormalizedLoad[] = [];
    const observedInWindow = new Set<string>();
    let boundaryFound = false;
    for (const load of scan.loads) {
      const loadKey = getGlobalLoadKey(load);
      if (await this.seenLoads.has(scan.searchId, loadKey)) {
        boundaryFound = true;
        break;
      }
      if (!observedInWindow.has(loadKey)) {
        observedInWindow.add(loadKey);
        newLoads.push(load);
      }
    }
    return {
      newLoads,
      seeded: false,
      boundaryFound,
      overflowRisk: scan.isTruncated && !boundaryFound
    };
  }

  public async acknowledge(scan: OrderedLoadScan, result: NewLoadScanResult): Promise<void> {
    if (result.seeded) return;
    for (const load of result.newLoads) await this.seenLoads.add(scan.searchId, getGlobalLoadKey(load));
  }
}
