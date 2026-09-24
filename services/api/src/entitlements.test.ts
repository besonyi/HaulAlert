import assert from "node:assert/strict";
import test from "node:test";

import { PlanLimitExceededError, PostgresEntitlementRepository } from "./entitlements.js";

test("entitlements expose the active plan and enforce its alert limit", async () => {
  const repository = new PostgresEntitlementRepository({
    query: async () => ({ rows: [{ plan_id: "starter", plan_name: "Starter", max_active_alerts: "3", active_alert_count: "3", status: "active", current_period_ends_at: null, cancel_at_period_end: false }] })
  });
  assert.deepEqual(await repository.getForUser("11111111-1111-4111-8111-111111111111"), {
    planId: "starter", planName: "Starter", maxActiveAlerts: 3, activeAlertCount: 3, subscriptionStatus: "active", currentPeriodEndsAt: null, cancelAtPeriodEnd: false
  });
  await assert.rejects(() => repository.assertCanCreateAlert("11111111-1111-4111-8111-111111111111"), PlanLimitExceededError);
});

test("cancelling a subscription keeps its current entitlement available", async () => {
  let calls = 0;
  const repository = new PostgresEntitlementRepository({
    query: async () => {
      calls += 1;
      if (calls === 1) return { rows: [{ plan_id: "starter", status: "active", current_period_ends_at: null, cancel_at_period_end: true }] };
      return { rows: [{ plan_id: "starter", plan_name: "Starter", max_active_alerts: 3, active_alert_count: 1, status: "active", current_period_ends_at: null, cancel_at_period_end: true }] };
    }
  });
  assert.equal((await repository.cancelAtPeriodEnd("11111111-1111-4111-8111-111111111111"))?.cancelAtPeriodEnd, true);
});
