import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAdminSearchQuery, PostgresAdminSearchRepository } from "./admin-search.js";

test("admin search returns bounded support summaries across operational records", async () => {
  const statements: string[] = [];
  const repository = new PostgresAdminSearchRepository({
    query: async (statement, parameters) => {
      statements.push(statement);
      assert.deepEqual(parameters, ["7722"]);
      if (statements.length === 1) return { rows: [{ id: "u-1", telegram_user_id: "7722", created_at: "2026-09-24T12:00:00Z" }] };
      if (statements.length === 2) return { rows: [{ id: "a-1", name: "West route", status: "active", telegram_user_id: "7722", updated_at: "2026-09-24T12:01:00Z" }] };
      if (statements.length === 3) return { rows: [{ provider: "central-dispatch", provider_load_id: "load-1", pickup: "Los Angeles, CA", delivery: "Phoenix, AZ", first_seen_at: "2026-09-24T12:02:00Z" }] };
      return { rows: [{ id: "d-1", status: "sent", alert_name: "West route", telegram_user_id: "7722", load_key: "central-dispatch:load-1", created_at: "2026-09-24T12:03:00Z" }] };
    }
  });

  assert.deepEqual(await repository.search(" 7722 "), {
    users: [{ id: "u-1", telegramUserId: "7722", createdAt: "2026-09-24T12:00:00.000Z" }],
    alerts: [{ id: "a-1", name: "West route", status: "active", telegramUserId: "7722", updatedAt: "2026-09-24T12:01:00.000Z" }],
    loads: [{ provider: "central-dispatch", providerLoadId: "load-1", pickup: "Los Angeles, CA", delivery: "Phoenix, AZ", firstSeenAt: "2026-09-24T12:02:00.000Z" }],
    deliveries: [{ id: "d-1", status: "sent", alertName: "West route", telegramUserId: "7722", loadKey: "central-dispatch:load-1", createdAt: "2026-09-24T12:03:00.000Z" }]
  });
  assert.equal(statements.length, 4);
  assert.match(statements[3] ?? "", /LIMIT 20/);
});

test("admin search rejects empty and excessively broad queries", () => {
  assert.throws(() => normalizeAdminSearchQuery("x"), /2 and 80/);
  assert.throws(() => normalizeAdminSearchQuery("x".repeat(81)), /2 and 80/);
});
