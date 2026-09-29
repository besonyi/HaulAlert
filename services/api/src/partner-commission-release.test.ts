import assert from "node:assert/strict";
import test from "node:test";

import { PostgresPartnerCommissionReleaseRepository } from "./partner-commission-release.js";

test("partner commission release claims only due pending commissions in a bounded batch", async () => {
  let statement = "";
  let parameters: readonly unknown[] | undefined;
  const repository = new PostgresPartnerCommissionReleaseRepository({
    query: async (sql, values) => {
      statement = sql;
      parameters = values;
      return { rows: [{ id: "one" }, { id: "two" }] };
    }
  });
  assert.equal(await repository.releaseDue(25), 2);
  assert.deepEqual(parameters, [25]);
  assert.match(statement, /status = 'pending' AND hold_until <= now\(\)/);
  assert.match(statement, /FOR UPDATE SKIP LOCKED/);
  assert.match(statement, /status = 'available'/);
  assert.match(statement, /INSERT INTO partner_ledger_entries/);
  assert.match(statement, /'commission_available'/);
  assert.match(statement, /ON CONFLICT DO NOTHING/);
});

test("partner commission release rejects unsafe batch sizes", async () => {
  const repository = new PostgresPartnerCommissionReleaseRepository({ query: async () => ({ rows: [] }) });
  await assert.rejects(() => repository.releaseDue(0), /between 1 and 1000/);
  await assert.rejects(() => repository.releaseDue(1_001), /between 1 and 1000/);
});
