import type { SqlExecutor } from "@haulalert/notification-service";

export interface AdminUserSearchResult {
  readonly id: string;
  readonly telegramUserId: string;
  readonly createdAt: string;
}

export interface AdminAlertSearchResult {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly telegramUserId: string;
  readonly updatedAt: string;
}

export interface AdminLoadSearchResult {
  readonly provider: string;
  readonly providerLoadId: string;
  readonly pickup: string;
  readonly delivery: string;
  readonly firstSeenAt: string;
}

export interface AdminDeliverySearchResult {
  readonly id: string;
  readonly status: string;
  readonly alertName: string;
  readonly telegramUserId: string;
  readonly loadKey: string;
  readonly createdAt: string;
}

export interface AdminSearchResults {
  readonly users: readonly AdminUserSearchResult[];
  readonly alerts: readonly AdminAlertSearchResult[];
  readonly loads: readonly AdminLoadSearchResult[];
  readonly deliveries: readonly AdminDeliverySearchResult[];
}

/** Bounded operator search that returns only support-safe account and load summaries. */
export class PostgresAdminSearchRepository {
  public constructor(private readonly database: SqlExecutor) {}

  public async search(query: string): Promise<AdminSearchResults> {
    const term = normalizeAdminSearchQuery(query);
    const [users, alerts, loads, deliveries] = await Promise.all([
      this.database.query(`SELECT id, telegram_user_id, created_at FROM users
        WHERE telegram_user_id::text ILIKE '%' || $1 || '%' OR id::text ILIKE '%' || $1 || '%'
        ORDER BY created_at DESC LIMIT 20`, [term]),
      this.database.query(`SELECT alerts.id, alerts.name, alerts.status, users.telegram_user_id, alerts.updated_at
        FROM alerts JOIN users ON users.id = alerts.user_id
        WHERE alerts.name ILIKE '%' || $1 || '%' OR users.telegram_user_id::text ILIKE '%' || $1 || '%'
        ORDER BY alerts.updated_at DESC LIMIT 20`, [term]),
      this.database.query(`SELECT provider, provider_load_id,
          COALESCE(NULLIF(concat_ws(', ', normalized_load->'pickup'->>'city', normalized_load->'pickup'->>'state'), ''), 'Unknown') AS pickup,
          COALESCE(NULLIF(concat_ws(', ', normalized_load->'delivery'->>'city', normalized_load->'delivery'->>'state'), ''), 'Unknown') AS delivery,
          first_seen_at
        FROM loads
        WHERE provider_load_id ILIKE '%' || $1 || '%'
          OR normalized_load->'pickup'->>'city' ILIKE '%' || $1 || '%'
          OR normalized_load->'delivery'->>'city' ILIKE '%' || $1 || '%'
          OR normalized_load->'broker'->>'mcNumber' ILIKE '%' || $1 || '%'
        ORDER BY first_seen_at DESC LIMIT 20`, [term]),
      this.database.query(`SELECT deliveries.id, deliveries.status, alerts.name AS alert_name, users.telegram_user_id,
          loads.provider || ':' || loads.provider_load_id AS load_key, deliveries.created_at
        FROM notification_deliveries AS deliveries
        JOIN alerts ON alerts.id = deliveries.alert_id
        JOIN users ON users.id = deliveries.user_id
        JOIN loads ON loads.id = deliveries.load_id
        WHERE alerts.name ILIKE '%' || $1 || '%'
          OR users.telegram_user_id::text ILIKE '%' || $1 || '%'
          OR loads.provider_load_id ILIKE '%' || $1 || '%'
        ORDER BY deliveries.created_at DESC LIMIT 20`, [term])
    ]);
    return {
      users: users.rows.map(user),
      alerts: alerts.rows.map(alert),
      loads: loads.rows.map(load),
      deliveries: deliveries.rows.map(delivery)
    };
  }
}

export function normalizeAdminSearchQuery(value: string): string {
  const query = value.trim();
  if (query.length < 2 || query.length > 80) throw new Error("Search query must contain between 2 and 80 characters");
  return query;
}

function user(row: Record<string, unknown>): AdminUserSearchResult {
  return { id: text(row.id, "user id"), telegramUserId: text(row.telegram_user_id, "Telegram user ID"), createdAt: timestamp(row.created_at, "user created") };
}

function alert(row: Record<string, unknown>): AdminAlertSearchResult {
  return { id: text(row.id, "alert id"), name: text(row.name, "alert name"), status: text(row.status, "alert status"), telegramUserId: text(row.telegram_user_id, "Telegram user ID"), updatedAt: timestamp(row.updated_at, "alert updated") };
}

function load(row: Record<string, unknown>): AdminLoadSearchResult {
  return { provider: text(row.provider, "load provider"), providerLoadId: text(row.provider_load_id, "provider load ID"), pickup: text(row.pickup, "pickup"), delivery: text(row.delivery, "delivery"), firstSeenAt: timestamp(row.first_seen_at, "load first seen") };
}

function delivery(row: Record<string, unknown>): AdminDeliverySearchResult {
  return { id: text(row.id, "delivery id"), status: text(row.status, "delivery status"), alertName: text(row.alert_name, "alert name"), telegramUserId: text(row.telegram_user_id, "Telegram user ID"), loadKey: text(row.load_key, "load key"), createdAt: timestamp(row.created_at, "delivery created") };
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Expected ${name}`);
  return value;
}

function timestamp(value: unknown, name: string): string {
  const date = value instanceof Date ? value : new Date(text(value, name));
  if (Number.isNaN(date.getTime())) throw new Error(`Expected valid ${name} timestamp`);
  return date.toISOString();
}
