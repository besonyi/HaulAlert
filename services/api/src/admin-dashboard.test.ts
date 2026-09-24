import assert from "node:assert/strict";
import test from "node:test";

import { PostgresAdminDashboardRepository } from "./admin-dashboard.js";

test("admin dashboard aggregates only operational counts", async () => {
  const statements: string[] = [];
  const repository = new PostgresAdminDashboardRepository({
    query: async (statement) => {
      statements.push(statement);
      if (statements.length === 1) return { rows: [{ users: "3", active_alerts: "5", loads: "8" }] };
      if (statements.length === 2) return { rows: [{ key: "central-dispatch:healthy", count: "1" }] };
      if (statements.length === 3) return { rows: [{ key: "central-dispatch:ready", count: "4" }] };
      if (statements.length === 4) return { rows: [{ key: "sent", count: "7" }, { key: "dead_letter", count: "1" }] };
      if (statements.length === 5) return { rows: [{ provider: "central-dispatch", code: "offline", observed_at: "2026-09-24T12:00:00Z" }] };
      if (statements.length === 6) return { rows: [{ provider: "central-dispatch", code: "degraded", observed_at: "2026-09-24T13:00:00Z", next_recovery_at: "2026-09-24T13:02:00Z" }] };
      return { rows: [{ provider: "central-dispatch", code: "scan_failed", observed_at: "2026-09-24T14:00:00Z" }] };
    }
  });

  assert.deepEqual(await repository.getOverview(), {
    users: 3,
    activeAlerts: 5,
    loads: 8,
    sessions: [{ key: "central-dispatch:healthy", count: 1 }],
    tabs: [{ key: "central-dispatch:ready", count: 4 }],
    deliveries: [{ key: "sent", count: 7 }, { key: "dead_letter", count: 1 }],
    recovery: [
      { kind: "scan", provider: "central-dispatch", code: "scan_failed", observedAt: "2026-09-24T14:00:00.000Z", nextRecoveryAt: null },
      { kind: "tab", provider: "central-dispatch", code: "degraded", observedAt: "2026-09-24T13:00:00.000Z", nextRecoveryAt: "2026-09-24T13:02:00.000Z" },
      { kind: "session", provider: "central-dispatch", code: "offline", observedAt: "2026-09-24T12:00:00.000Z", nextRecoveryAt: null }
    ]
  });
  assert.equal(statements.length, 7);
  assert.match(statements[0] ?? "", /count\(\*\) FROM users/);
  assert.match(statements[6] ?? "", /error_code IS NOT NULL/);
});
