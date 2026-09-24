import assert from "node:assert/strict";
import test from "node:test";

import { PostgresReferralRepository } from "./referrals.js";

test("referral summary derives the capped pre-partner monthly credit", async () => {
  let parameters: readonly unknown[] | undefined;
  const repository = new PostgresReferralRepository({ query: async (_statement, values) => {
    parameters = values;
    return { rows: [{ code: "A7K92D4F", total_invited: "7", registered: "2", active_paid: "4", inactive: "1" }] };
  } });

  assert.deepEqual(await repository.getForUser("11111111-1111-4111-8111-111111111111"), {
    code: "A7K92D4F",
    totalInvited: 7,
    registered: 2,
    activePaid: 4,
    inactive: 1,
    monthlyCreditCents: 2000,
    partnerProgressActivePaid: 4,
    partnerUnlockAt: 5
  });
  assert.deepEqual(parameters, ["11111111-1111-4111-8111-111111111111"]);
});
