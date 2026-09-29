import assert from "node:assert/strict";
import test from "node:test";

import { PostgresPartnerAccountRepository } from "./partner-accounts.js";

test("partner approval changes only a pending account to commission mode", async () => {
  let statement = "";
  let parameters: readonly unknown[] | undefined;
  const repository = new PostgresPartnerAccountRepository({ query: async (sql, values) => {
    statement = sql;
    parameters = values;
    return { rows: [{ status: "active", reward_mode: "partner_commission", commission_rate_basis_points: 1500, risk_level: "new", hold_days: 21, partner_eligible_at: "2026-09-24T00:00:00.000Z", approved_at: "2026-09-25T00:00:00.000Z" }] };
  } });
  assert.equal((await repository.approve("11111111-1111-4111-8111-111111111111"))?.rewardMode, "partner_commission");
  assert.deepEqual(parameters, ["11111111-1111-4111-8111-111111111111"]);
  assert.match(statement, /status = 'pending_approval'/);
});

test("partner risk changes the future-commission hold without altering historic commissions", async () => {
  let statement = "";
  let parameters: readonly unknown[] | undefined;
  const repository = new PostgresPartnerAccountRepository({ query: async (sql, values) => {
    statement = sql;
    parameters = values;
    return { rows: [{ status: "active", reward_mode: "partner_commission", commission_rate_basis_points: 1500, risk_level: "high_risk", hold_days: 30, partner_eligible_at: "2026-09-24T00:00:00.000Z", approved_at: "2026-09-25T00:00:00.000Z" }] };
  } });
  const partner = await repository.setRiskLevel("11111111-1111-4111-8111-111111111111", "high_risk");
  assert.equal(partner?.riskLevel, "high_risk");
  assert.equal(partner?.holdDays, 30);
  assert.deepEqual(parameters, ["11111111-1111-4111-8111-111111111111", "high_risk"]);
  assert.match(statement, /WHEN 'trusted' THEN 14 WHEN 'high_risk' THEN 30 ELSE 21/);
  assert.doesNotMatch(statement, /partner_commissions/);
});
