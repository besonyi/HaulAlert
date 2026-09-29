import assert from "node:assert/strict";
import test from "node:test";

import { PostgresPartnerLedgerRepository } from "./partner-ledger.js";

test("partner ledger is bounded, newest-first, and scoped to the signed-in partner", async () => {
  let statement = "";
  let parameters: readonly unknown[] | undefined;
  const repository = new PostgresPartnerLedgerRepository({ query: async (sql, values) => {
    statement = sql;
    parameters = values;
    return { rows: [{
      id: "11111111-1111-4111-8111-111111111111", entry_type: "refund_reversal",
      amount_cents: "-375", created_at: "2026-09-29T00:00:00.000Z"
    }] };
  } });
  assert.deepEqual(await repository.listForUser("22222222-2222-4222-8222-222222222222", 25), [{
    id: "11111111-1111-4111-8111-111111111111", entryType: "refund_reversal",
    amountCents: -375, createdAt: "2026-09-29T00:00:00.000Z"
  }]);
  assert.deepEqual(parameters, ["22222222-2222-4222-8222-222222222222", 25]);
  assert.match(statement, /JOIN partner_accounts/);
  assert.match(statement, /partner_accounts.user_id = \$1::uuid/);
  assert.match(statement, /ORDER BY partner_ledger_entries.created_at DESC/);
});

test("partner ledger rejects unsafe result limits", async () => {
  const repository = new PostgresPartnerLedgerRepository({ query: async () => ({ rows: [] }) });
  await assert.rejects(() => repository.listForUser("22222222-2222-4222-8222-222222222222", 0), /between 1 and 100/);
});
