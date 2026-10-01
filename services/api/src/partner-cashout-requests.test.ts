import assert from "node:assert/strict";
import test from "node:test";

import { InvalidPartnerCashOutRequestError, parseCashOutMethods, PostgresPartnerCashOutRequestRepository } from "./partner-cashout-requests.js";

test("cash-out methods are explicit, normalized, and disabled without configuration", () => {
  assert.deepEqual(parseCashOutMethods(undefined), []);
  assert.deepEqual(parseCashOutMethods("USDT:TRON, USDC:solana"), [
    { asset: "usdt", network: "tron" }, { asset: "usdc", network: "solana" }
  ]);
  assert.throws(() => parseCashOutMethods("USDT:TRON,USDT:TRON"), InvalidPartnerCashOutRequestError);
});

test("cash-out requests reserve the gross amount through immutable net and fee entries", async () => {
  let statement = "";
  let parameters: readonly unknown[] | undefined;
  const repository = new PostgresPartnerCashOutRequestRepository({ query: async (sql, values) => {
    statement = sql;
    parameters = values;
    return { rows: [{
      id: "11111111-1111-4111-8111-111111111111", asset: "usdt", network: "tron", wallet_address: "TQ5TzYjD4Qh9nk7qA4f8NBxYz3xF5W9K8L",
      gross_amount_cents: 5000, total_fee_cents: 175, net_amount_cents: 4825, status: "requested", manual_review_required: true,
      requested_at: "2026-10-01T00:00:00.000Z"
    }] };
  } }, [{ asset: "usdt", network: "tron" }]);

  assert.deepEqual(await repository.createForUser({
    userId: "22222222-2222-4222-8222-222222222222", asset: "USDT", network: "TRON",
    walletAddress: "TQ5TzYjD4Qh9nk7qA4f8NBxYz3xF5W9K8L", grossAmountCents: 5000
  }), {
    id: "11111111-1111-4111-8111-111111111111", asset: "usdt", network: "tron", walletDisplay: "TQ5TzY…9K8L",
    grossAmountCents: 5000, totalFeeCents: 175, netAmountCents: 4825, status: "requested", manualReviewRequired: true,
    requestedAt: "2026-10-01T00:00:00.000Z"
  });
  assert.deepEqual(parameters, ["22222222-2222-4222-8222-222222222222", "usdt", "tron", "TQ5TzYjD4Qh9nk7qA4f8NBxYz3xF5W9K8L", 5000, 100, 75, 175, 4825]);
  assert.match(statement, /FOR UPDATE/);
  assert.match(statement, /partner_cashout_holds/);
  assert.match(statement, /available_balance\.available_cents >= \$5/);
  assert.match(statement, /'withdrawal'::text, -created_request\.net_amount_cents/);
  assert.match(statement, /'cashout_fee'::text, -created_request\.total_fee_cents/);
});

test("cash-out requests reject unconfigured methods and malformed wallet addresses", async () => {
  const repository = new PostgresPartnerCashOutRequestRepository({ query: async () => ({ rows: [] }) }, [{ asset: "usdc", network: "solana" }]);
  await assert.rejects(() => repository.createForUser({
    userId: "22222222-2222-4222-8222-222222222222", asset: "usdt", network: "tron", walletAddress: "TQ5TzYjD4Qh9nk7qA4f8NBxYz3xF5W9K8L", grossAmountCents: 5000
  }), InvalidPartnerCashOutRequestError);
  await assert.rejects(() => repository.createForUser({
    userId: "22222222-2222-4222-8222-222222222222", asset: "usdc", network: "solana", walletAddress: "spaces are not allowed", grossAmountCents: 5000
  }), InvalidPartnerCashOutRequestError);
});

test("cash-out request history masks wallets and cancellation restores the reserved gross amount", async () => {
  const statements: string[] = [];
  const parameters: Array<readonly unknown[] | undefined> = [];
  const repository = new PostgresPartnerCashOutRequestRepository({ query: async (sql, values) => {
    statements.push(sql);
    parameters.push(values);
    return statements.length === 1
      ? { rows: [{
        id: "11111111-1111-4111-8111-111111111111", asset: "usdt", network: "tron", wallet_address: "TQ5TzYjD4Qh9nk7qA4f8NBxYz3xF5W9K8L",
        gross_amount_cents: 5000, total_fee_cents: 175, net_amount_cents: 4825, status: "cancelled", manual_review_required: true,
        requested_at: "2026-10-01T00:00:00.000Z"
      }] }
      : { rows: [{ id: "11111111-1111-4111-8111-111111111111" }] };
  } }, [{ asset: "usdt", network: "tron" }]);

  const userId = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(await repository.listForUser(userId), [{
    id: "11111111-1111-4111-8111-111111111111", asset: "usdt", network: "tron", walletDisplay: "TQ5TzY…9K8L",
    grossAmountCents: 5000, totalFeeCents: 175, netAmountCents: 4825, status: "cancelled", manualReviewRequired: true,
    requestedAt: "2026-10-01T00:00:00.000Z"
  }]);
  assert.equal(await repository.cancelForUser(userId, "11111111-1111-4111-8111-111111111111"), true);
  assert.deepEqual(parameters, [[userId, 20], ["11111111-1111-4111-8111-111111111111", userId]]);
  assert.match(statements[1] ?? "", /status = 'requested'/);
  assert.match(statements[1] ?? "", /'cashout_reversal', gross_amount_cents/);
  assert.match(statements[1] ?? "", /cashout_request_id/);
});

test("admin review masks wallets, records the reviewer, and restores a rejected reservation", async () => {
  const statements: string[] = [];
  const parameters: Array<readonly unknown[] | undefined> = [];
  const repository = new PostgresPartnerCashOutRequestRepository({ query: async (sql, values) => {
    statements.push(sql);
    parameters.push(values);
    return statements.length === 1
      ? { rows: [{
        id: "11111111-1111-4111-8111-111111111111", partner_user_id: "22222222-2222-4222-8222-222222222222", asset: "usdc", network: "solana", wallet_address: "7fQ5TzYjD4Qh9nk7qA4f8NBxYz3xF5W9K8L",
        gross_amount_cents: 7500, total_fee_cents: 213, net_amount_cents: 7287, status: "requested", manual_review_required: true,
        requested_at: "2026-10-01T00:00:00.000Z"
      }] }
      : { rows: [{ id: "11111111-1111-4111-8111-111111111111", partner_user_id: "22222222-2222-4222-8222-222222222222", status: statements.length === 2 ? "approved" : "rejected" }] };
  } }, []);

  assert.deepEqual(await repository.listForAdminReview(), [{
    id: "11111111-1111-4111-8111-111111111111", partnerUserId: "22222222-2222-4222-8222-222222222222", asset: "usdc", network: "solana", walletDisplay: "7fQ5Tz…9K8L",
    grossAmountCents: 7500, totalFeeCents: 213, netAmountCents: 7287, status: "requested", manualReviewRequired: true,
    requestedAt: "2026-10-01T00:00:00.000Z"
  }]);
  assert.deepEqual(await repository.reviewForAdmin("11111111-1111-4111-8111-111111111111", "approve", "12345"), {
    id: "11111111-1111-4111-8111-111111111111", partnerUserId: "22222222-2222-4222-8222-222222222222", status: "approved"
  });
  assert.deepEqual(await repository.reviewForAdmin("11111111-1111-4111-8111-111111111111", "reject", "12345"), {
    id: "11111111-1111-4111-8111-111111111111", partnerUserId: "22222222-2222-4222-8222-222222222222", status: "rejected"
  });
  assert.deepEqual(parameters, [[50], ["11111111-1111-4111-8111-111111111111", "12345"], ["11111111-1111-4111-8111-111111111111", "12345"]]);
  assert.match(statements[1] ?? "", /SET status = 'approved', reviewed_at = now\(\), reviewed_by_telegram_user_id = \$2/);
  assert.match(statements[2] ?? "", /SET status = 'rejected', reviewed_at = now\(\), reviewed_by_telegram_user_id = \$2/);
  assert.match(statements[2] ?? "", /'cashout_reversal', gross_amount_cents/);
});
