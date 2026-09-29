import assert from "node:assert/strict";
import test from "node:test";

import { PostgresPartnerEarningsRepository } from "./partner-earnings.js";

test("partner earnings are scoped to one account and separate pending from available funds", async () => {
  let statement = "";
  let parameters: readonly unknown[] | undefined;
  const repository = new PostgresPartnerEarningsRepository({
    query: async (sql, values) => {
      statement = sql;
      parameters = values;
      return { rows: [{
        status: "active", commission_rate_basis_points: "1500", hold_days: "21",
        pending_cents: "375", available_cents: "750", lifetime_earned_cents: "1125",
        next_available_at: "2026-10-20T00:00:00.000Z"
      }] };
    }
  });

  assert.deepEqual(await repository.getForUser("11111111-1111-4111-8111-111111111111"), {
    status: "active", commissionRateBasisPoints: 1500, holdDays: 21,
    pendingCents: 375, availableCents: 750, lifetimeEarnedCents: 1125,
    nextAvailableAt: "2026-10-20T00:00:00.000Z"
  });
  assert.deepEqual(parameters, ["11111111-1111-4111-8111-111111111111"]);
  assert.match(statement, /sum\(amount_cents\) FROM partner_ledger_entries/);
});

test("partner earnings preserve a negative ledger balance for future clawback recovery", async () => {
  const repository = new PostgresPartnerEarningsRepository({
    query: async () => ({ rows: [{
      status: "active", commission_rate_basis_points: 1500, hold_days: 21,
      pending_cents: 0, available_cents: -375, lifetime_earned_cents: 375,
      next_available_at: null
    }] })
  });
  assert.equal((await repository.getForUser("11111111-1111-4111-8111-111111111111"))?.availableCents, -375);
});

test("partner earnings are absent for a user without a partner account", async () => {
  const repository = new PostgresPartnerEarningsRepository({ query: async () => ({ rows: [] }) });
  assert.equal(await repository.getForUser("11111111-1111-4111-8111-111111111111"), undefined);
});
