import type { AlertMatch } from "@haulalert/alert-matcher";
import { getGlobalLoadKey, normalizedLoadSchema, type NormalizedLoad } from "@haulalert/load-model";

import { getDeliveryKey } from "./index.js";

export interface SqlQueryResult {
  readonly rows: readonly Record<string, unknown>[];
}

/** Compatible with a parameterized PostgreSQL client such as pg.Pool. */
export interface SqlExecutor {
  query(
    statement: string,
    parameters: readonly unknown[]
  ): Promise<SqlQueryResult>;
}

export interface ClaimedNotificationDelivery {
  readonly deliveryId: string;
  readonly deliveryKey: string;
  readonly attemptCount: number;
  readonly match: AlertMatch;
}

export interface DurableNotificationDeliveryRepository {
  claimDue(limit: number, now?: Date): Promise<readonly ClaimedNotificationDelivery[]>;
  markSent(deliveryId: string, telegramMessageId: string | null, now?: Date): Promise<boolean>;
  scheduleRetry(deliveryId: string, errorMessage: string, availableAt: Date, now?: Date): Promise<boolean>;
  markDeadLetter(deliveryId: string, errorMessage: string, now?: Date): Promise<boolean>;
}

export type DurableDeliveryEnqueueResult =
  | { readonly status: "queued"; readonly deliveryId: string; readonly deliveryKey: string }
  | { readonly status: "duplicate"; readonly deliveryKey: string };

export interface DurableNotificationDeliveryEnqueuer {
  enqueue(match: AlertMatch, availableAt?: Date): Promise<DurableDeliveryEnqueueResult>;
}

/**
 * PostgreSQL persistence for queue jobs. Every state transition is one SQL
 * statement so a worker crash cannot create a half-recorded attempt.
 */
export class PostgresNotificationDeliveryRepository implements DurableNotificationDeliveryRepository, DurableNotificationDeliveryEnqueuer {
  public constructor(private readonly database: SqlExecutor) {}

  public async enqueue(match: AlertMatch, availableAt: Date = new Date()): Promise<DurableDeliveryEnqueueResult> {
    const loadId = await this.findLoadId(match.load);
    const deliveryKey = getDeliveryKey(match);
    const result = await this.database.query(
      `INSERT INTO notification_deliveries (
        delivery_key, load_id, alert_id, user_id, status, available_at
      ) VALUES ($1, $2::uuid, $3::uuid, $4::uuid, 'queued', $5::timestamptz)
      ON CONFLICT (delivery_key) DO NOTHING
      RETURNING id`,
      [deliveryKey, loadId, match.alertId, match.userId, availableAt.toISOString()]
    );
    const deliveryId = getString(result.rows[0]?.id);
    return deliveryId === undefined
      ? { status: "duplicate", deliveryKey }
      : { status: "queued", deliveryId, deliveryKey };
  }

  public async claimDue(limit: number, now: Date = new Date()): Promise<readonly ClaimedNotificationDelivery[]> {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");

    const result = await this.database.query(
      `WITH candidates AS (
        SELECT id
        FROM notification_deliveries
        WHERE status IN ('queued', 'retry_scheduled')
          AND available_at <= $1::timestamptz
        ORDER BY available_at, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      ), claimed AS (
        UPDATE notification_deliveries AS delivery
        SET status = 'delivering', claimed_at = $1::timestamptz, updated_at = $1::timestamptz
        FROM candidates
        WHERE delivery.id = candidates.id
        RETURNING delivery.id, delivery.delivery_key, delivery.attempt_count,
          delivery.alert_id, delivery.user_id, delivery.load_id
      )
      SELECT claimed.id, claimed.delivery_key, claimed.attempt_count,
        claimed.alert_id, claimed.user_id, load.normalized_load, user_account.telegram_chat_id
      FROM claimed
      JOIN loads AS load ON load.id = claimed.load_id
      JOIN users AS user_account ON user_account.id = claimed.user_id`,
      [now.toISOString(), limit]
    );

    return result.rows.map((row) => toClaimedDelivery(row as ClaimedDeliveryRow));
  }

  public async markSent(
    deliveryId: string,
    telegramMessageId: string | null,
    now: Date = new Date()
  ): Promise<boolean> {
    return this.transition(
      `WITH updated AS (
        UPDATE notification_deliveries
        SET status = 'sent', attempt_count = attempt_count + 1,
          sent_at = $2::timestamptz, telegram_message_id = $3::bigint,
          last_error = NULL, updated_at = $2::timestamptz
        WHERE id = $1::uuid AND status = 'delivering'
        RETURNING id, attempt_count
      ), recorded AS (
        INSERT INTO notification_attempts (delivery_id, attempt_number, outcome, telegram_message_id)
        SELECT id, attempt_count, 'sent', $3::bigint FROM updated
        RETURNING delivery_id
      )
      SELECT delivery_id FROM recorded`,
      [deliveryId, now.toISOString(), telegramMessageId]
    );
  }

  public async scheduleRetry(
    deliveryId: string,
    errorMessage: string,
    availableAt: Date,
    now: Date = new Date()
  ): Promise<boolean> {
    return this.transition(
      `WITH updated AS (
        UPDATE notification_deliveries
        SET status = 'retry_scheduled', attempt_count = attempt_count + 1,
          available_at = $3::timestamptz, claimed_at = NULL, last_error = $2,
          updated_at = $4::timestamptz
        WHERE id = $1::uuid AND status = 'delivering'
        RETURNING id, attempt_count
      ), recorded AS (
        INSERT INTO notification_attempts (delivery_id, attempt_number, outcome, error_message)
        SELECT id, attempt_count, 'retry_scheduled', $2 FROM updated
        RETURNING delivery_id
      )
      SELECT delivery_id FROM recorded`,
      [deliveryId, errorMessage, availableAt.toISOString(), now.toISOString()]
    );
  }

  public async markDeadLetter(
    deliveryId: string,
    errorMessage: string,
    now: Date = new Date()
  ): Promise<boolean> {
    return this.transition(
      `WITH updated AS (
        UPDATE notification_deliveries
        SET status = 'dead_letter', attempt_count = attempt_count + 1,
          claimed_at = NULL, last_error = $2, updated_at = $3::timestamptz
        WHERE id = $1::uuid AND status = 'delivering'
        RETURNING id, attempt_count
      ), recorded AS (
        INSERT INTO notification_attempts (delivery_id, attempt_number, outcome, error_message)
        SELECT id, attempt_count, 'dead_letter', $2 FROM updated
        RETURNING delivery_id
      )
      SELECT delivery_id FROM recorded`,
      [deliveryId, errorMessage, now.toISOString()]
    );
  }

  private async findLoadId(load: NormalizedLoad): Promise<string> {
    const result = await this.database.query(
      "SELECT id FROM loads WHERE provider = $1 AND provider_load_id = $2",
      [load.provider, load.providerLoadId]
    );
    const loadId = getString(result.rows[0]?.id);
    if (loadId === undefined) {
      throw new Error(`Cannot queue delivery for a load that is not persisted: ${getGlobalLoadKey(load)}`);
    }
    return loadId;
  }

  private async transition(statement: string, parameters: readonly unknown[]): Promise<boolean> {
    const result = await this.database.query(statement, parameters);
    return result.rows.length === 1;
  }
}

interface ClaimedDeliveryRow extends Record<string, unknown> {
  readonly id: string;
  readonly delivery_key: string;
  readonly attempt_count: number;
  readonly alert_id: string;
  readonly user_id: string;
  readonly telegram_chat_id: string | number | null;
  readonly normalized_load: unknown;
}

function toClaimedDelivery(row: ClaimedDeliveryRow): ClaimedNotificationDelivery {
  const load = normalizedLoadSchema.parse(row.normalized_load);
  if (row.telegram_chat_id === null) {
    throw new Error(`Cannot deliver ${row.delivery_key}: the user has no Telegram chat ID`);
  }

  return {
    deliveryId: row.id,
    deliveryKey: row.delivery_key,
    attemptCount: row.attempt_count,
    match: {
      alertId: row.alert_id,
      userId: row.user_id,
      telegramChatId: String(row.telegram_chat_id),
      load
    }
  };
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
