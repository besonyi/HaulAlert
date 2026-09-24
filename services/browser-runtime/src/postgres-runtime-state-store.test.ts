import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PostgresBrowserRuntimeStateStore, type RuntimeSqlExecutor } from "./postgres-runtime-state-store.js";

describe("PostgreSQL browser runtime state store", () => {
  it("loads credential-free session and tab metadata", async () => {
    let call = 0;
    const database: RuntimeSqlExecutor = { query: async () => ({ rows: call++ === 0
      ? [{ id: "central-1", provider: "central-dispatch", status: "healthy", created_at: "2026-09-24T12:00:00Z", last_heartbeat_at: null }]
      : [{ id: "tab-1", provider_search_id: null, session_id: "central-1", provider: "central-dispatch", source_filter_hash: "hash", status: "ready", created_at: "2026-09-24T12:00:00Z", last_scan_at: null, recovery_attempt_count: 0, next_recovery_at: null }]
    }) };
    const snapshot = await new PostgresBrowserRuntimeStateStore(database).load();
    assert.equal(snapshot.sessions[0]?.id, "central-1");
    assert.equal(snapshot.tabs[0]?.sessionId, "central-1");
    assert.equal(snapshot.tabs[0]?.lastScanAt, null);
    assert.equal(snapshot.tabs[0]?.recoveryAttemptCount, 0);
  });

  it("upserts sessions and tabs without persisting credentials", async () => {
    const statements: string[] = [];
    const database: RuntimeSqlExecutor = { query: async (statement) => { statements.push(statement); return { rows: [] }; } };
    await new PostgresBrowserRuntimeStateStore(database).save({
      sessions: [{ id: "central-1", provider: "central-dispatch", status: "healthy", createdAt: "2026-09-24T12:00:00.000Z", lastHeartbeatAt: null }],
      tabs: [{ id: "tab-1", providerSearchId: null, sessionId: "central-1", provider: "central-dispatch", sourceFilterHash: "hash", status: "ready", createdAt: "2026-09-24T12:00:00.000Z", lastScanAt: null, recoveryAttemptCount: 0, nextRecoveryAt: null }]
    });
    assert.equal(statements.length, 2);
    assert.match(statements[0] ?? "", /ON CONFLICT \(id\) DO UPDATE/);
    assert.match(statements[1] ?? "", /browser_search_tabs/);
    assert.doesNotMatch(statements.join("\n"), /cookie|token|credential/i);
  });
});
