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
