import type { AlertMatch } from "@haulalert/alert-matcher";
import type { NormalizedLoad } from "@haulalert/load-model";
import { getDeliveryKey, type SqlExecutor } from "@haulalert/notification-service";

export interface QueuedOutboxDelivery {
  readonly deliveryId: string;
  readonly deliveryKey: string;
}

export interface TransactionalLoadOutboxResult {
  readonly isNew: boolean;
  readonly queuedDeliveries: readonly QueuedOutboxDelivery[];
}

export interface TransactionalLoadOutbox {
  persist(load: NormalizedLoad, matches: readonly AlertMatch[], seenAt?: Date): Promise<TransactionalLoadOutboxResult>;
}

/**
 * Atomically persists a newly discovered load and every notification job it
 * created. PostgreSQL executes one statement as one transaction, eliminating
 * the failure window between load insert and delivery enqueue.
 */
export class PostgresLoadDeliveryOutbox implements TransactionalLoadOutbox {
  public constructor(private readonly database: SqlExecutor) {}

  public async persist(
    load: NormalizedLoad,
    matches: readonly AlertMatch[],
    seenAt: Date = new Date()
  ): Promise<TransactionalLoadOutboxResult> {
    const timestamp = seenAt.toISOString();
    const result = await this.database.query(
      `WITH inserted_load AS (
        INSERT INTO loads (provider, provider_load_id, normalized_load, first_seen_at, last_seen_at)
        VALUES ($1, $2, $3::jsonb, $4::timestamptz, $4::timestamptz)
        ON CONFLICT (provider, provider_load_id) DO NOTHING
        RETURNING id
      ), delivery_inputs AS (
        SELECT delivery_key, alert_id, user_id
        FROM jsonb_to_recordset($5::jsonb) AS input(delivery_key text, alert_id uuid, user_id uuid)
      ), queued AS (
        INSERT INTO notification_deliveries (delivery_key, load_id, alert_id, user_id, status, available_at)
        SELECT input.delivery_key, inserted_load.id, input.alert_id, input.user_id, 'queued', $4::timestamptz
        FROM delivery_inputs AS input
        CROSS JOIN inserted_load
        ON CONFLICT (delivery_key) DO NOTHING
        RETURNING id, delivery_key
      )
      SELECT (SELECT id FROM inserted_load) AS load_id, queued.id AS delivery_id, queued.delivery_key
      FROM queued
      UNION ALL
      SELECT (SELECT id FROM inserted_load) AS load_id, NULL::uuid AS delivery_id, NULL::text AS delivery_key
      WHERE NOT EXISTS (SELECT 1 FROM queued)`,
      [
        load.provider,
        load.providerLoadId,
        JSON.stringify(load),
        timestamp,
        JSON.stringify(matches.map((match) => ({
          delivery_key: getDeliveryKey(match),
          alert_id: match.alertId,
          user_id: match.userId
        })))
      ]
    );
    const isNew = result.rows.some((row) => typeof row.load_id === "string");
    if (!isNew) {
      await this.database.query(
        `UPDATE loads
        SET normalized_load = $3::jsonb, last_seen_at = $4::timestamptz
        WHERE provider = $1 AND provider_load_id = $2`,
        [load.provider, load.providerLoadId, JSON.stringify(load), timestamp]
      );
    }
    return {
      isNew,
      queuedDeliveries: result.rows.flatMap((row) => {
        return typeof row.delivery_id === "string" && typeof row.delivery_key === "string"
          ? [{ deliveryId: row.delivery_id, deliveryKey: row.delivery_key }]
          : [];
      })
    };
  }
}
