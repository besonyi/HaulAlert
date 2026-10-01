import assert from "node:assert/strict";
import test from "node:test";

import { InvalidPartnerCashOutQuoteAmountError, PartnerCashOutQuoteService, quotePartnerCashOut } from "./partner-cashout-quote.js";

test("cash-out quote uses the V1 fixed plus 1.5 percent fee with half-up cents", () => {
  assert.deepEqual(quotePartnerCashOut(5_000), {
    grossAmountCents: 5_000, fixedFeeCents: 100, processingFeeCents: 75, totalFeeCents: 175, netAmountCents: 4_825
  });
  assert.deepEqual(quotePartnerCashOut(7_500), {
    grossAmountCents: 7_500, fixedFeeCents: 100, processingFeeCents: 113, totalFeeCents: 213, netAmountCents: 7_287
  });
  assert.throws(() => quotePartnerCashOut(4_999), InvalidPartnerCashOutQuoteAmountError);
});

test("cash-out quote service requires current eligibility and sufficient available balance", async () => {
  const eligible = new PartnerCashOutQuoteService({ getForUser: async () => ({
    status: "active", commissionRateBasisPoints: 1500, holdDays: 21, pendingCents: 0,
    availableCents: 7_500, lifetimeEarnedCents: 7_500, nextAvailableAt: null,
    cashOutMinimumCents: 5_000, cashOutEligible: true, cashOutBlockReason: null
  }) });
  assert.equal((await eligible.quoteForUser("11111111-1111-4111-8111-111111111111", 7_500))?.netAmountCents, 7_287);
  assert.equal(await eligible.quoteForUser("11111111-1111-4111-8111-111111111111", 7_501), undefined);

  const restricted = new PartnerCashOutQuoteService({ getForUser: async () => ({
    status: "active", commissionRateBasisPoints: 1500, holdDays: 21, pendingCents: 0,
    availableCents: 7_500, lifetimeEarnedCents: 7_500, nextAvailableAt: null,
    cashOutMinimumCents: 5_000, cashOutEligible: false, cashOutBlockReason: "account_restricted"
  }) });
  assert.equal(await restricted.quoteForUser("11111111-1111-4111-8111-111111111111", 5_000), undefined);
});
