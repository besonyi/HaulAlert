import {
  parseCanonicalFilter,
  type CanonicalFilter
} from "@haulalert/canonical-filter";
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

/** PostgreSQL repository for the customer-facing alert lifecycle. */
export class PostgresAlertRepository {
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

export {
  verifyTelegramMiniAppInitData,
  type AuthenticatedTelegramUser,
  type TelegramMiniAppAuthOptions
} from "./telegram-miniapp-auth.js";
