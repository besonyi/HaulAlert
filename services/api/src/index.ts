import {
  parseCanonicalFilter,
  type CanonicalFilter
} from "@haulalert/canonical-filter";
import { normalizedLoadSchema, type NormalizedLoad } from "@haulalert/load-model";
import type { SqlExecutor } from "@haulalert/notification-service";

export type ManagedAlertStatus = "active" | "paused";

export interface ManagedAlert {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly status: ManagedAlertStatus;
  readonly filter: CanonicalFilter;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateAlertInput {
  readonly userId: string;
  readonly filter: unknown;
}

export interface UpdateAlertInput extends CreateAlertInput {
  readonly alertId: string;
}

export interface AlertManagementRepository {
  create(input: CreateAlertInput): Promise<ManagedAlert>;
  listForUser(userId: string): Promise<readonly ManagedAlert[]>;
  update(input: UpdateAlertInput): Promise<ManagedAlert | undefined>;
  setStatus(alertId: string, userId: string, status: ManagedAlertStatus): Promise<ManagedAlert | undefined>;
  duplicate(alertId: string, userId: string, name: string): Promise<ManagedAlert | undefined>;
  remove(alertId: string, userId: string): Promise<boolean>;
}

export type NotificationDeliveryStatus = "queued" | "delivering" | "retry_scheduled" | "sent" | "dead_letter" | "cancelled";

export interface RecentNotification {
  readonly deliveryId: string;
  readonly alertName: string;
  readonly status: NotificationDeliveryStatus;
  readonly createdAt: Date;
  readonly sentAt: Date | null;
  readonly load: NormalizedLoad;
}

export interface CustomerDashboard {
  readonly activeAlertCount: number;
  readonly loadsFoundLast24Hours: number;
  readonly recentNotifications: readonly RecentNotification[];
}

export interface DashboardRepository {
  getForUser(userId: string, recentLimit?: number): Promise<CustomerDashboard>;
}

/** Customer-visible alert and delivery summary, always scoped to one user. */
export class PostgresDashboardRepository implements DashboardRepository {
  public constructor(private readonly database: SqlExecutor) {}

  public async getForUser(userId: string, recentLimit: number = 8): Promise<CustomerDashboard> {
    if (!Number.isInteger(recentLimit) || recentLimit < 1 || recentLimit > 50) {
      throw new Error("recentLimit must be an integer between 1 and 50");
    }
    const counts = await this.database.query(
      `SELECT
        (SELECT count(*) FROM alerts WHERE user_id = $1::uuid AND status = 'active') AS active_alert_count,
        (SELECT count(DISTINCT load_id) FROM notification_deliveries
          WHERE user_id = $1::uuid AND created_at >= now() - interval '24 hours') AS loads_found_last_24_hours`,
      [userId]
    );
    const recent = await this.database.query(
      `SELECT d.id AS delivery_id, a.name AS alert_name, d.status, d.created_at, d.sent_at, l.normalized_load
      FROM notification_deliveries AS d
      INNER JOIN loads AS l ON l.id = d.load_id
      INNER JOIN alerts AS a ON a.id = d.alert_id
      WHERE d.user_id = $1::uuid
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT $2`,
      [userId, recentLimit]
    );
    const row = counts.rows[0];
    if (row === undefined) throw new Error("Expected dashboard counts from PostgreSQL");
    return {
      activeAlertCount: parseCount(row.active_alert_count, "active_alert_count"),
      loadsFoundLast24Hours: parseCount(row.loads_found_last_24_hours, "loads_found_last_24_hours"),
      recentNotifications: recent.rows.map(parseRecentNotification)
    };
  }
}

/** PostgreSQL repository for the customer-facing alert lifecycle. */
export class PostgresAlertRepository implements AlertManagementRepository {
  public constructor(private readonly database: SqlExecutor) {}

  public async create(input: CreateAlertInput): Promise<ManagedAlert> {
    const filter = parseCanonicalFilter(input.filter);
    const result = await this.database.query(
      `INSERT INTO alerts (user_id, name, canonical_filter)
      VALUES ($1::uuid, $2, $3::jsonb)
      RETURNING id, user_id, name, status, canonical_filter, created_at, updated_at`,
      [input.userId, filter.name, JSON.stringify(filter)]
    );
    return parseManagedAlert(result.rows[0]);
  }

  public async listForUser(userId: string): Promise<readonly ManagedAlert[]> {
    const result = await this.database.query(
      `SELECT id, user_id, name, status, canonical_filter, created_at, updated_at
      FROM alerts
      WHERE user_id = $1::uuid AND status IN ('active', 'paused')
      ORDER BY updated_at DESC, id DESC`,
      [userId]
    );
    return result.rows.map(parseManagedAlert);
  }

  public async update(input: UpdateAlertInput): Promise<ManagedAlert | undefined> {
    const filter = parseCanonicalFilter(input.filter);
    const result = await this.database.query(
      `UPDATE alerts
      SET name = $3, canonical_filter = $4::jsonb, updated_at = now()
      WHERE id = $1::uuid AND user_id = $2::uuid AND status IN ('active', 'paused')
      RETURNING id, user_id, name, status, canonical_filter, created_at, updated_at`,
      [input.alertId, input.userId, filter.name, JSON.stringify(filter)]
    );
    return result.rows[0] === undefined ? undefined : parseManagedAlert(result.rows[0]);
  }

  public async setStatus(
    alertId: string,
    userId: string,
    status: ManagedAlertStatus
  ): Promise<ManagedAlert | undefined> {
    const result = await this.database.query(
      `UPDATE alerts
      SET status = $3, updated_at = now()
      WHERE id = $1::uuid AND user_id = $2::uuid AND status IN ('active', 'paused')
      RETURNING id, user_id, name, status, canonical_filter, created_at, updated_at`,
      [alertId, userId, status]
    );
    return result.rows[0] === undefined ? undefined : parseManagedAlert(result.rows[0]);
  }

  public async duplicate(
    alertId: string,
    userId: string,
    name: string
  ): Promise<ManagedAlert | undefined> {
    const normalizedName = name.trim();
    if (normalizedName.length === 0 || normalizedName.length > 80) {
      throw new Error("Alert name must contain between 1 and 80 characters");
    }
    const result = await this.database.query(
      `INSERT INTO alerts (user_id, name, canonical_filter)
      SELECT user_id, $3, jsonb_set(canonical_filter, '{name}', to_jsonb($3::text))
      FROM alerts
      WHERE id = $1::uuid AND user_id = $2::uuid AND status IN ('active', 'paused')
      RETURNING id, user_id, name, status, canonical_filter, created_at, updated_at`,
      [alertId, userId, normalizedName]
    );
    return result.rows[0] === undefined ? undefined : parseManagedAlert(result.rows[0]);
  }

  /** Preserves historical deliveries while removing the alert from all customer views. */
  public async remove(alertId: string, userId: string): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE alerts
      SET status = 'deleted', deleted_at = now(), updated_at = now()
      WHERE id = $1::uuid AND user_id = $2::uuid AND status IN ('active', 'paused')
      RETURNING id`,
      [alertId, userId]
    );
    return result.rows.length === 1;
  }
}

function parseManagedAlert(row: Record<string, unknown> | undefined): ManagedAlert {
  if (row === undefined) throw new Error("Expected an alert row from PostgreSQL");
  const id = requiredString(row.id, "id");
  const userId = requiredString(row.user_id, "user_id");
  const name = requiredString(row.name, "name");
  const status = row.status;
  if (status !== "active" && status !== "paused") throw new Error("Unexpected persisted alert status");

  return {
    id,
    userId,
    name,
    status,
    filter: parseCanonicalFilter(parseJson(row.canonical_filter, "canonical_filter")),
    createdAt: parseDate(row.created_at, "created_at"),
    updatedAt: parseDate(row.updated_at, "updated_at")
  };
}

function requiredString(value: unknown, column: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Expected ${column} to be a string`);
  return value;
}

function parseJson(value: unknown, column: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`Expected ${column} to contain valid JSON`);
  }
}

function parseDate(value: unknown, column: string): Date {
  const date = value instanceof Date ? value : new Date(requiredString(value, column));
  if (Number.isNaN(date.getTime())) throw new Error(`Expected ${column} to be a valid timestamp`);
  return date;
}

function parseRecentNotification(row: Record<string, unknown>): RecentNotification {
  const status = row.status;
  if (
    status !== "queued" && status !== "delivering" && status !== "retry_scheduled"
    && status !== "sent" && status !== "dead_letter" && status !== "cancelled"
  ) {
    throw new Error("Unexpected persisted notification status");
  }
  return {
    deliveryId: requiredString(row.delivery_id, "delivery_id"),
    alertName: requiredString(row.alert_name, "alert_name"),
    status,
    createdAt: parseDate(row.created_at, "created_at"),
    sentAt: row.sent_at === null || row.sent_at === undefined ? null : parseDate(row.sent_at, "sent_at"),
    load: normalizedLoadSchema.parse(parseJson(row.normalized_load, "normalized_load"))
  };
}

function parseCount(value: unknown, column: string): number {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Expected ${column} to be a non-negative count`);
  return count;
}

export {
  verifyTelegramMiniAppInitData,
  type AuthenticatedTelegramUser,
  type TelegramMiniAppAuthOptions
} from "./telegram-miniapp-auth.js";
