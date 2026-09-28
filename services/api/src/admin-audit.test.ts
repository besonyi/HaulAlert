import assert from "node:assert/strict";
import test from "node:test";

import { PostgresAdminAuditRepository } from "./admin-audit.js";

test("admin audit records the operator and target for a partner approval request", async () => {
  let statement = "";
  let parameters: readonly unknown[] | undefined;
  const repository = new PostgresAdminAuditRepository({
    query: async (sql, values) => {
      statement = sql;
      parameters = values;
      return { rows: [] };
    }
  });

  await repository.record({
    actorTelegramUserId: "12345",
    action: "partner_approval_requested",
    subjectUserId: "11111111-1111-4111-8111-111111111111"
  });

  assert.match(statement, /INSERT INTO admin_audit_events/);
  assert.deepEqual(parameters, ["12345", "partner_approval_requested", "11111111-1111-4111-8111-111111111111"]);
});

test("admin audit rejects malformed operator identities", async () => {
  const repository = new PostgresAdminAuditRepository({ query: async () => ({ rows: [] }) });
  await assert.rejects(
    () => repository.record({ actorTelegramUserId: "not-an-id", action: "partner_approval_requested", subjectUserId: "11111111-1111-4111-8111-111111111111" }),
    /integer Telegram operator ID/
  );
});

test("admin audit returns a bounded newest-first operator trail", async () => {
  let parameters: readonly unknown[] | undefined;
  const repository = new PostgresAdminAuditRepository({
    query: async (_sql, values) => {
      parameters = values;
      return { rows: [{
        id: "22222222-2222-4222-8222-222222222222",
        actor_telegram_user_id: "12345",
        action: "partner_approval_requested",
        subject_user_id: "11111111-1111-4111-8111-111111111111",
        created_at: "2026-09-28T12:00:00.000Z"
      }] };
    }
  });

  assert.deepEqual(await repository.getRecent(10), [{
    id: "22222222-2222-4222-8222-222222222222",
    actorTelegramUserId: "12345",
    action: "partner_approval_requested",
    subjectUserId: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-09-28T12:00:00.000Z"
  }]);
  assert.deepEqual(parameters, [10]);
  await assert.rejects(() => repository.getRecent(0), /Audit limit/);
});
