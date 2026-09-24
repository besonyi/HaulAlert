import type { SqlExecutor } from "@haulalert/notification-service";

export interface OperationalCount {
  readonly key: string;
  readonly count: number;
}

/** Credential-free operational summary exposed only through the Telegram allowlisted admin route. */
export interface AdminSystemOverview {
  readonly users: number;
  readonly activeAlerts: number;
  readonly loads: number;
  readonly sessions: readonly OperationalCount[];
  readonly tabs: readonly OperationalCount[];
  readonly deliveries: readonly OperationalCount[];
}

export class PostgresAdminDashboardRepository {
  public constructor(private readonly database: SqlExecutor) {}

  public async getOverview(): Promise<AdminSystemOverview> {
    const [totals, sessions, tabs, deliveries] = await Promise.all([
      this.database.query(`SELECT
        (SELECT count(*) FROM users) AS users,
        (SELECT count(*) FROM alerts WHERE status = 'active') AS active_alerts,
        (SELECT count(*) FROM loads) AS loads`, []),
      this.database.query("SELECT provider || ':' || status AS key, count(*) AS count FROM browser_sessions GROUP BY provider, status ORDER BY key", []),
      this.database.query("SELECT provider || ':' || status AS key, count(*) AS count FROM browser_search_tabs GROUP BY provider, status ORDER BY key", []),
      this.database.query("SELECT status AS key, count(*) AS count FROM notification_deliveries GROUP BY status ORDER BY key", [])
    ]);
    const row = totals.rows[0];
    if (row === undefined) throw new Error("Expected admin dashboard totals from PostgreSQL");
    return {
      users: count(row.users, "users"),
      activeAlerts: count(row.active_alerts, "active_alerts"),
      loads: count(row.loads, "loads"),
      sessions: sessions.rows.map(summary),
      tabs: tabs.rows.map(summary),
      deliveries: deliveries.rows.map(summary)
    };
  }
}

function summary(row: Record<string, unknown>): OperationalCount {
  if (typeof row.key !== "string" || row.key.length === 0) throw new Error("Expected operational dashboard key");
  return { key: row.key, count: count(row.count, row.key) };
}

function count(value: unknown, name: string): number {
  const result = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`Expected non-negative count for ${name}`);
  return result;
}
