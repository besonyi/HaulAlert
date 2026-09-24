import type { SqlExecutor } from "@haulalert/notification-service";

export interface OperationalCount {
  readonly key: string;
  readonly count: number;
}

export interface OperationalRecoveryItem {
  readonly kind: "session" | "tab" | "scan";
  readonly provider: string;
  /** A persisted status or safe, normalized error classification. */
  readonly code: string;
  readonly observedAt: string;
  readonly nextRecoveryAt: string | null;
}

/** Credential-free operational summary exposed only through the Telegram allowlisted admin route. */
export interface AdminSystemOverview {
  readonly users: number;
  readonly activeAlerts: number;
  readonly loads: number;
  readonly sessions: readonly OperationalCount[];
  readonly tabs: readonly OperationalCount[];
  readonly deliveries: readonly OperationalCount[];
  readonly recovery: readonly OperationalRecoveryItem[];
}

export class PostgresAdminDashboardRepository {
  public constructor(private readonly database: SqlExecutor) {}

  public async getOverview(): Promise<AdminSystemOverview> {
    const [totals, sessions, tabs, deliveries, unhealthySessions, degradedTabs, failedScans] = await Promise.all([
      this.database.query(`SELECT
        (SELECT count(*) FROM users) AS users,
        (SELECT count(*) FROM alerts WHERE status = 'active') AS active_alerts,
        (SELECT count(*) FROM loads) AS loads`, []),
      this.database.query("SELECT provider || ':' || status AS key, count(*) AS count FROM browser_sessions GROUP BY provider, status ORDER BY key", []),
      this.database.query("SELECT provider || ':' || status AS key, count(*) AS count FROM browser_search_tabs GROUP BY provider, status ORDER BY key", []),
      this.database.query("SELECT status AS key, count(*) AS count FROM notification_deliveries GROUP BY status ORDER BY key", []),
      this.database.query(`SELECT provider, status AS code, COALESCE(last_heartbeat_at, updated_at, created_at) AS observed_at
        FROM browser_sessions WHERE status <> 'healthy' ORDER BY updated_at DESC LIMIT 10`, []),
      this.database.query(`SELECT provider, status AS code, updated_at AS observed_at, next_recovery_at
        FROM browser_search_tabs WHERE status = 'degraded' ORDER BY updated_at DESC LIMIT 10`, []),
      this.database.query(`SELECT searches.provider, scans.error_code AS code, scans.completed_at AS observed_at
        FROM provider_scans AS scans JOIN provider_searches AS searches ON searches.id = scans.provider_search_id
        WHERE scans.error_code IS NOT NULL ORDER BY scans.completed_at DESC LIMIT 10`, [])
    ]);
    const row = totals.rows[0];
    if (row === undefined) throw new Error("Expected admin dashboard totals from PostgreSQL");
    return {
      users: count(row.users, "users"),
      activeAlerts: count(row.active_alerts, "active_alerts"),
      loads: count(row.loads, "loads"),
      sessions: sessions.rows.map(summary),
      tabs: tabs.rows.map(summary),
      deliveries: deliveries.rows.map(summary),
      recovery: [
        ...unhealthySessions.rows.map((row) => recoveryItem(row, "session")),
        ...degradedTabs.rows.map((row) => recoveryItem(row, "tab")),
        ...failedScans.rows.map((row) => recoveryItem(row, "scan"))
      ].sort((left, right) => right.observedAt.localeCompare(left.observedAt))
    };
  }
}

function summary(row: Record<string, unknown>): OperationalCount {
  if (typeof row.key !== "string" || row.key.length === 0) throw new Error("Expected operational dashboard key");
  return { key: row.key, count: count(row.count, row.key) };
}

function recoveryItem(row: Record<string, unknown>, kind: OperationalRecoveryItem["kind"]): OperationalRecoveryItem {
  const provider = text(row.provider, "provider");
  const code = text(row.code, "recovery code");
  return {
    kind,
    provider,
    code,
    observedAt: timestamp(row.observed_at, "recovery observation"),
    nextRecoveryAt: row.next_recovery_at === null || row.next_recovery_at === undefined
      ? null
      : timestamp(row.next_recovery_at, "next recovery")
  };
}

function count(value: unknown, name: string): number {
  const result = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`Expected non-negative count for ${name}`);
  return result;
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
