import { type AlertMatch } from "@haulalert/alert-matcher";
import type { NormalizedLoad } from "@haulalert/load-model";
import type {
  DurableDeliveryEnqueueResult,
  DurableNotificationDeliveryEnqueuer,
  SqlExecutor
} from "@haulalert/notification-service";

export interface LoadPersistence {
  record(load: NormalizedLoad, seenAt?: Date): Promise<{ readonly isNew: boolean }>;
}

export interface AlertMatchFinder {
  findMatches(load: NormalizedLoad, now?: Date): readonly AlertMatch[] | Promise<readonly AlertMatch[]>;
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
