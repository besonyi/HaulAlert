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
      if (statements.length === 5) return { rows: [{ queued_count: "3", retry_scheduled_count: "2", due_now_count: "4", oldest_created_at: "2026-09-24T11:00:00Z" }] };
      if (statements.length === 6) return { rows: [{ provider: "central-dispatch", code: "offline", observed_at: "2026-09-24T12:00:00Z" }] };
      if (statements.length === 7) return { rows: [{ provider: "central-dispatch", code: "degraded", observed_at: "2026-09-24T13:00:00Z", next_recovery_at: "2026-09-24T13:02:00Z" }] };
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
    notificationBacklog: { queued: 3, retryScheduled: 2, dueNow: 4, oldestCreatedAt: "2026-09-24T11:00:00.000Z" },
    recovery: [
      { kind: "scan", provider: "central-dispatch", code: "scan_failed", observedAt: "2026-09-24T14:00:00.000Z", nextRecoveryAt: null },
      { kind: "tab", provider: "central-dispatch", code: "degraded", observedAt: "2026-09-24T13:00:00.000Z", nextRecoveryAt: "2026-09-24T13:02:00.000Z" },
      { kind: "session", provider: "central-dispatch", code: "offline", observedAt: "2026-09-24T12:00:00.000Z", nextRecoveryAt: null }
    ]
  });
  assert.equal(statements.length, 8);
  assert.match(statements[0] ?? "", /count\(\*\) FROM users/);
  assert.match(statements[4] ?? "", /available_at <= now\(\)/);
  assert.match(statements[7] ?? "", /error_code IS NOT NULL/);
});
