import assert from "node:assert/strict";
import test from "node:test";

import { PostgresSubscriptionCheckoutService, StripeCheckoutClient, SubscriptionAlreadyEssentialError } from "./stripe-billing.js";

const config = {
  secretKey: "sk_test_example", essentialPriceId: "price_essential",
  successUrl: "https://haulalert.example/billing/success", cancelUrl: "https://haulalert.example/billing/cancel",
  portalReturnUrl: "https://haulalert.example/account"
};
const userId = "11111111-1111-4111-8111-111111111111";

test("Stripe Checkout is created server-side with the internal identity only as reconciliation metadata", async () => {
  let request: { readonly input: unknown; readonly init?: RequestInit } | undefined;
  const client = new StripeCheckoutClient(config, async (input, init) => {
    request = { input, ...(init === undefined ? {} : { init }) };
    return new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/test" }), { status: 200 });
  });
  assert.deepEqual(await client.createEssentialCheckout(userId, "cus_existing"), { url: "https://checkout.stripe.com/c/pay/test" });
  assert.equal(request?.input, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal((request?.init?.headers as Record<string, string>).authorization, "Bearer sk_test_example");
  const body = String(request?.init?.body);
  assert.match(body, /mode=subscription/);
  assert.match(body, /client_reference_id=11111111/);
  assert.match(body, /subscription_data%5Bmetadata%5D%5Bhaulalert_user_id%5D/);
  assert.match(body, /customer=cus_existing/);
});

test("only Free accounts receive an Essential checkout", async () => {
  const checkout = new StripeCheckoutClient(config, async () => new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/test" })));
  const service = new PostgresSubscriptionCheckoutService({ query: async () => ({ rows: [{ plan_id: "essential", stripe_customer_id: null }] }) }, checkout);
  await assert.rejects(() => service.createEssentialCheckout(userId), SubscriptionAlreadyEssentialError);
});

test("an Essential account opens the short-lived Stripe billing portal instead of changing local state", async () => {
  let request: { readonly input: unknown; readonly init?: RequestInit } | undefined;
  const checkout = new StripeCheckoutClient(config, async (input, init) => {
    request = { input, ...(init === undefined ? {} : { init }) };
    return new Response(JSON.stringify({ url: "https://billing.stripe.com/p/session/test" }));
  });
  const { PostgresSubscriptionPortalService } = await import("./stripe-billing.js");
  const service = new PostgresSubscriptionPortalService({ query: async () => ({ rows: [{ plan_id: "essential", stripe_customer_id: "cus_existing" }] }) }, checkout);
  assert.equal((await service.createPortal(userId)).url, "https://billing.stripe.com/p/session/test");
  assert.equal(request?.input, "https://api.stripe.com/v1/billing_portal/sessions");
  assert.match(String(request?.init?.body), /customer=cus_existing/);
  assert.match(String(request?.init?.body), /return_url=https%3A%2F%2Fhaulalert.example%2Faccount/);
});
