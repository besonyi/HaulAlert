import assert from "node:assert/strict";
import test from "node:test";

import { PostgresPartnerCashOutHoldRepository } from "./partner-cashout-holds.js";

test("cash-out holds are active-partner scoped and idempotent", async () => {
  let statement = "";
  let parameters: readonly unknown[] | undefined;
  const repository = new PostgresPartnerCashOutHoldRepository({ query: async (sql, values) => {
    statement = sql;
    parameters = values;
    return { rows: [{ id: "hold-1" }] };
  } });
  assert.equal(await repository.freeze("11111111-1111-4111-8111-111111111111"), true);
  assert.deepEqual(parameters, ["11111111-1111-4111-8111-111111111111"]);
  assert.match(statement, /status IN \('active', 'suspended'\)/);
  assert.match(statement, /ON CONFLICT DO NOTHING/);
});

test("cash-out unfreeze resolves only the current partner's open hold", async () => {
  let statement = "";
  const repository = new PostgresPartnerCashOutHoldRepository({ query: async (sql) => {
    statement = sql;
    return { rows: [{ id: "hold-1" }] };
  } });
  assert.equal(await repository.unfreeze("11111111-1111-4111-8111-111111111111"), true);
  assert.match(statement, /status = 'resolved'/);
  assert.match(statement, /partner_accounts.user_id = \$1::uuid/);
  assert.match(statement, /partner_cashout_holds.status = 'open'/);
});
