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
      return { rows: [{ key: "sent", count: "7" }, { key: "dead_letter", count: "1" }] };
    }
  });

  assert.deepEqual(await repository.getOverview(), {
    users: 3,
    activeAlerts: 5,
    loads: 8,
    sessions: [{ key: "central-dispatch:healthy", count: 1 }],
    tabs: [{ key: "central-dispatch:ready", count: 4 }],
    deliveries: [{ key: "sent", count: 7 }, { key: "dead_letter", count: 1 }]
  });
  assert.equal(statements.length, 4);
  assert.match(statements[0] ?? "", /count\(\*\) FROM users/);
});
