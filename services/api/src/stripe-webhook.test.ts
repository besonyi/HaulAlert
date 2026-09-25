import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  InvalidStripeWebhookSignatureError,
  PostgresStripeWebhookEventProcessor,
  StripeWebhookHandler,
  parseStripeSubscriptionEvent,
  verifyStripeWebhookSignature
} from "./stripe-webhook.js";

const secret = "whsec_example_webhook_secret";
const timestamp = 1_790_000_000;
const userId = "11111111-1111-4111-8111-111111111111";

function invoicePayload(): Buffer {
  return Buffer.from(JSON.stringify({
    id: "evt_paid_invoice", type: "invoice.paid", data: { object: {
      id: "in_paid", customer: "cus_customer", subscription: "sub_subscription",
      metadata: { haulalert_user_id: userId }
    } }
  }));
}

function signedHeader(payload: Buffer): string {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload.toString("utf8")}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

test("Stripe signatures are verified against the exact raw payload and timestamp", () => {
  const payload = invoicePayload();
  verifyStripeWebhookSignature(payload, signedHeader(payload), secret, timestamp * 1_000);
  assert.throws(() => verifyStripeWebhookSignature(payload, "t=1,v1=bad", secret, timestamp * 1_000), InvalidStripeWebhookSignatureError);
  assert.throws(() => verifyStripeWebhookSignature(payload, signedHeader(payload), secret, (timestamp + 301) * 1_000), InvalidStripeWebhookSignatureError);
});

test("only payment lifecycle events can update a subscription", () => {
  assert.deepEqual(parseStripeSubscriptionEvent(invoicePayload()), {
    eventId: "evt_paid_invoice", eventType: "invoice.paid", userId,
    customerId: "cus_customer", subscriptionId: "sub_subscription",
    paymentStatus: "paid", subscriptionStatus: "active"
  });
  assert.equal(parseStripeSubscriptionEvent(Buffer.from(JSON.stringify({
    id: "evt_other", type: "customer.created", data: { object: {} }
  }))), undefined);
  assert.deepEqual(parseStripeSubscriptionEvent(Buffer.from(JSON.stringify({
    id: "evt_refund", type: "charge.refunded", data: { object: { customer: "cus_customer", metadata: { haulalert_user_id: userId } } }
  }))), {
    eventId: "evt_refund", eventType: "charge.refunded", userId,
    customerId: "cus_customer", subscriptionId: undefined,
    paymentStatus: "refunded", subscriptionStatus: "active"
  });
});

test("Stripe processing records the event before updating payment and referral state", async () => {
  let statement = "";
  let parameters: readonly unknown[] | undefined;
  const processor = new PostgresStripeWebhookEventProcessor({ query: async (sql, values) => {
    statement = sql;
    parameters = values;
    return { rows: [{ matched_count: "1", inserted_count: "1" }] };
  } });
  const event = parseStripeSubscriptionEvent(invoicePayload());
  if (event === undefined) throw new Error("Expected invoice event");
  assert.equal(await processor.process(event), "processed");
  assert.deepEqual(parameters, ["evt_paid_invoice", "invoice.paid", userId, "cus_customer", "sub_subscription", "paid", "active"]);
  assert.match(statement, /ON CONFLICT \(event_id\) DO NOTHING/);
  assert.match(statement, /latest_payment_status = COALESCE/);
  assert.match(statement, /THEN 'active_paid' ELSE 'inactive'/);
});

test("valid, unrelated events are acknowledged without a database write", async () => {
  let processed = false;
  const handler = new StripeWebhookHandler(secret, { process: async () => { processed = true; return "processed"; } });
  const payload = Buffer.from(JSON.stringify({ id: "evt_other", type: "customer.created", data: { object: {} } }));
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload.toString("utf8")}`).digest("hex");
  const originalNow = Date.now;
  Date.now = () => timestamp * 1_000;
  try {
    assert.equal(await handler.handle(payload, `t=${timestamp},v1=${signature}`), "ignored");
    assert.equal(processed, false);
  } finally {
    Date.now = originalNow;
  }
});
