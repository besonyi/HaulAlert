import { type AlertMatch } from "@haulalert/alert-matcher";
import type { NormalizedLoad } from "@haulalert/load-model";
import {
  NewLoadDetector,
  type NewLoadScanResult,
  type OrderedLoadScan
} from "@haulalert/new-load-detector";
import type {
  DurableDeliveryEnqueueResult,
  DurableNotificationDeliveryEnqueuer,
  SqlExecutor
} from "@haulalert/notification-service";
import { getDeliveryKey } from "@haulalert/notification-service";
import type { TransactionalLoadOutbox } from "./postgres-load-delivery-outbox.js";

export interface LoadPersistence {
  record(load: NormalizedLoad, seenAt?: Date): Promise<{ readonly isNew: boolean }>;
}

export interface AlertMatchFinder {
  findMatches(load: NormalizedLoad, now?: Date): readonly AlertMatch[] | Promise<readonly AlertMatch[]>;
}

export interface LoadIngestion {
  ingest(load: NormalizedLoad, now?: Date): Promise<IngestionResult>;
}

/** Stores normalized loads once globally, while updating their latest observation. */
export class PostgresLoadRepository implements LoadPersistence {
  public constructor(private readonly database: SqlExecutor) {}

  public async record(
    load: NormalizedLoad,
    seenAt: Date = new Date()
  ): Promise<{ readonly isNew: boolean }> {
    const timestamp = seenAt.toISOString();
    const inserted = await this.database.query(
      `INSERT INTO loads (provider, provider_load_id, normalized_load, first_seen_at, last_seen_at)
      VALUES ($1, $2, $3::jsonb, $4::timestamptz, $4::timestamptz)
      ON CONFLICT (provider, provider_load_id) DO NOTHING
      RETURNING id`,
      [load.provider, load.providerLoadId, JSON.stringify(load), timestamp]
    );
    if (inserted.rows.length === 1) return { isNew: true };

    await this.database.query(
      `UPDATE loads
      SET normalized_load = $3::jsonb, last_seen_at = $4::timestamptz
      WHERE provider = $1 AND provider_load_id = $2`,
      [load.provider, load.providerLoadId, JSON.stringify(load), timestamp]
    );
    return { isNew: false };
  }
}

export type IngestionDeliveryAttempt =
  | { readonly status: "queued"; readonly match: AlertMatch; readonly result: DurableDeliveryEnqueueResult }
  | { readonly status: "failed"; readonly match: AlertMatch; readonly error: Error };

export type IngestionResult =
  | { readonly status: "known"; readonly load: NormalizedLoad }
  | {
      readonly status: "new";
      readonly load: NormalizedLoad;
      readonly matches: readonly AlertMatch[];
      readonly deliveries: readonly IngestionDeliveryAttempt[];
    };

/** Durable bridge from a newly observed normalized load to queued user deliveries. */
export class DurableLoadIngestionService {
  public constructor(
    private readonly loads: LoadPersistence,
    private readonly alerts: AlertMatchFinder,
    private readonly deliveries: DurableNotificationDeliveryEnqueuer
  ) {}

  public async ingest(load: NormalizedLoad, now: Date = new Date()): Promise<IngestionResult> {
    const persisted = await this.loads.record(load, now);
    if (!persisted.isNew) return { status: "known", load };

    const matches = await this.alerts.findMatches(load, now);
    const deliveries = await Promise.all(matches.map(async (match): Promise<IngestionDeliveryAttempt> => {
      try {
        return { status: "queued", match, result: await this.deliveries.enqueue(match, now) };
      } catch (cause) {
        return {
          status: "failed",
          match,
          error: cause instanceof Error ? cause : new Error("Unknown durable delivery enqueue failure")
        };
      }
    }));

    return { status: "new", load, matches, deliveries };
  }
}

/** Uses the transactional outbox to avoid losing delivery jobs after a load insert. */
export class TransactionalLoadIngestionService implements LoadIngestion {
  public constructor(
    private readonly outbox: TransactionalLoadOutbox,
    private readonly alerts: AlertMatchFinder
  ) {}

  public async ingest(load: NormalizedLoad, now: Date = new Date()): Promise<IngestionResult> {
    const matches = await this.alerts.findMatches(load, now);
    const persisted = await this.outbox.persist(load, matches, now);
    if (!persisted.isNew) return { status: "known", load };

    const deliveriesByKey = new Map(persisted.queuedDeliveries.map((delivery) => [delivery.deliveryKey, delivery]));
    return {
      status: "new",
      load,
      matches,
      deliveries: matches.map((match): IngestionDeliveryAttempt => {
        const deliveryKey = getDeliveryKey(match);
        const queued = deliveriesByKey.get(deliveryKey);
        return queued === undefined
          ? { status: "queued", match, result: { status: "duplicate", deliveryKey } }
          : { status: "queued", match, result: { status: "queued", ...queued } };
      })
    };
  }
}

export interface ProviderLoadCollector<SearchTarget> {
  collect(target: SearchTarget): Promise<OrderedLoadScan>;
}

export interface ScannedIngestionResult {
  readonly scan: NewLoadScanResult;
  readonly ingestions: readonly IngestionResult[];
}

/**
 * Joins an ordered provider result window to the durable new-load path. The
 * initial scan seeds its boundary; only later unseen head rows are persisted,
 * matched, and queued for notification.
 */
export class ScanIngestionProcessor {
  public constructor(
    private readonly detector: NewLoadDetector,
    private readonly ingestion: LoadIngestion
  ) {}

  public async process(scan: OrderedLoadScan, now: Date = new Date()): Promise<ScannedIngestionResult> {
    const detection = this.detector.inspect(scan);
    const ingestions = await Promise.all(detection.newLoads.map((load) => this.ingestion.ingest(load, now)));
    return { scan: detection, ingestions };
  }

  public async collectAndProcess<SearchTarget>(
    collector: ProviderLoadCollector<SearchTarget>,
    target: SearchTarget,
    now: Date = new Date()
  ): Promise<ScannedIngestionResult> {
    return this.process(await collector.collect(target), now);
  }

  /**
   * Processes a scan and records its detection evidence. Ingestion remains the
   * source of truth if telemetry fails, so callers can surface the error without
   * replaying a successfully persisted load window.
   */
  public async processCompletedScan(
    completedScan: import("./postgres-scan-history.js").CompletedProviderScan,
    history: import("./postgres-scan-history.js").ScanHistoryRecorder
  ): Promise<ScannedIngestionResult & { readonly historyError?: Error }> {
    const processed = await this.process(completedScan.scan, completedScan.completedAt);
    try {
      await history.record(completedScan, processed.scan);
      return processed;
    } catch (cause) {
      return {
        ...processed,
        historyError: cause instanceof Error ? cause : new Error("Unknown scan history recording failure")
      };
    }
  }
}

export {
  PostgresScanHistoryRecorder,
  type CompletedProviderScan,
  type ScanHistoryRecorder
} from "./postgres-scan-history.js";
export {
  PostgresLoadDeliveryOutbox,
  type QueuedOutboxDelivery,
  type TransactionalLoadOutbox,
  type TransactionalLoadOutboxResult
} from "./postgres-load-delivery-outbox.js";
