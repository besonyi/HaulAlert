import type { BrowserRuntimeSnapshot, BrowserSession, PersistentSearchTab } from "@haulalert/browser-runtime-core";

export interface RuntimeSqlExecutor {
  query(statement: string, parameters: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

/** Stores only credential-free runtime metadata needed to resume tab allocation. */
export class PostgresBrowserRuntimeStateStore {
  public constructor(private readonly database: RuntimeSqlExecutor) {}

  public async load(): Promise<BrowserRuntimeSnapshot> {
    const [sessions, tabs] = await Promise.all([
      this.database.query("SELECT id, provider, status, created_at, last_heartbeat_at FROM browser_sessions ORDER BY id", []),
      this.database.query("SELECT id, provider_search_id, session_id, provider, status, source_filter_hash, created_at, last_scan_at FROM browser_search_tabs ORDER BY id", [])
    ]);
    return { sessions: sessions.rows.map(toSession), tabs: tabs.rows.map(toTab) };
  }

  public async save(snapshot: BrowserRuntimeSnapshot): Promise<void> {
    await Promise.all(snapshot.sessions.map((session) => this.database.query(
      `INSERT INTO browser_sessions (id, provider, status, created_at, last_heartbeat_at)
       VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, last_heartbeat_at = EXCLUDED.last_heartbeat_at, updated_at = now()`,
      [session.id, session.provider, session.status, session.createdAt, session.lastHeartbeatAt]
    )));
    await Promise.all(snapshot.tabs.map((tab) => this.database.query(
      `INSERT INTO browser_search_tabs (id, provider_search_id, session_id, provider, source_filter_hash, status, created_at, last_scan_at)
       VALUES ($1, $2::uuid, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, last_scan_at = EXCLUDED.last_scan_at, updated_at = now()`,
      [tab.id, tab.providerSearchId, tab.sessionId, tab.provider, tab.sourceFilterHash, tab.status, tab.createdAt, tab.lastScanAt]
    )));
  }
}

function toSession(row: Record<string, unknown>): BrowserSession {
  return { id: required(row.id), provider: provider(row.provider), status: sessionStatus(row.status), createdAt: timestamp(row.created_at), lastHeartbeatAt: nullableTimestamp(row.last_heartbeat_at) };
}
function toTab(row: Record<string, unknown>): PersistentSearchTab {
  return { id: required(row.id), providerSearchId: nullableString(row.provider_search_id), sessionId: required(row.session_id), provider: provider(row.provider), sourceFilterHash: required(row.source_filter_hash), status: tabStatus(row.status), createdAt: timestamp(row.created_at), lastScanAt: nullableTimestamp(row.last_scan_at) };
}
function required(value: unknown): string { if (typeof value !== "string" || !value) throw new Error("Invalid runtime metadata"); return value; }
function nullableString(value: unknown): string | null { return value === null || value === undefined ? null : required(value); }
function timestamp(value: unknown): string { const date = value instanceof Date ? value : new Date(required(value)); if (Number.isNaN(date.getTime())) throw new Error("Invalid runtime timestamp"); return date.toISOString(); }
function nullableTimestamp(value: unknown): string | null { return value === null || value === undefined ? null : timestamp(value); }
function provider(value: unknown): BrowserSession["provider"] { const item = required(value); if (item === "central-dispatch" || item === "super-dispatch" || item === "shipcars") return item; throw new Error("Invalid runtime provider"); }
function sessionStatus(value: unknown): BrowserSession["status"] { const item = required(value); if (["healthy", "degraded", "expired", "recovering", "offline"].includes(item)) return item as BrowserSession["status"]; throw new Error("Invalid session status"); }
function tabStatus(value: unknown): PersistentSearchTab["status"] { const item = required(value); if (["provisioning", "ready", "degraded", "closed"].includes(item)) return item as PersistentSearchTab["status"]; throw new Error("Invalid tab status"); }
