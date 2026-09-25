import assert from "node:assert/strict";
import test from "node:test";

import { getTelegramBotUsername, optionalStripeCheckoutConfig, optionalStripeWebhookSecret, withInviteLink } from "./server-main.js";

test("referral links use the configured Telegram bot username", () => {
  assert.equal(getTelegramBotUsername(undefined), "HaulAlertBot");
  assert.equal(getTelegramBotUsername("@CustomHaulBot"), "CustomHaulBot");
  assert.throws(() => getTelegramBotUsername("not valid"), /TELEGRAM_BOT_USERNAME/);
  assert.equal(withInviteLink({
    code: "A7K92D4F", totalInvited: 0, registered: 0, activePaid: 0, inactive: 0,
    monthlyCreditCents: 0, partnerProgressActivePaid: 0, partnerUnlockAt: 5, partnerStatus: "not_eligible"
  }, "CustomHaulBot").inviteLink, "https://t.me/CustomHaulBot?start=ref_A7K92D4F");
});

test("Stripe Checkout remains disabled until all required server settings exist", () => {
  assert.equal(optionalStripeCheckoutConfig({}), undefined);
  assert.deepEqual(optionalStripeCheckoutConfig({
    STRIPE_SECRET_KEY: "sk_test_example", STRIPE_ESSENTIAL_PRICE_ID: "price_essential",
    STRIPE_CHECKOUT_SUCCESS_URL: "https://haulalert.example/billing/success", STRIPE_CHECKOUT_CANCEL_URL: "https://haulalert.example/billing/cancel",
    STRIPE_BILLING_PORTAL_RETURN_URL: "https://haulalert.example/account"
  }), {
    secretKey: "sk_test_example", essentialPriceId: "price_essential",
    successUrl: "https://haulalert.example/billing/success", cancelUrl: "https://haulalert.example/billing/cancel",
    portalReturnUrl: "https://haulalert.example/account"
  });
  assert.throws(() => optionalStripeCheckoutConfig({ STRIPE_SECRET_KEY: "sk_test_example" }), /Stripe Checkout requires/);
});

test("Stripe webhook endpoint is disabled until its endpoint secret is configured", () => {
  assert.equal(optionalStripeWebhookSecret(undefined), undefined);
  assert.equal(optionalStripeWebhookSecret(" whsec_configured_secret "), "whsec_configured_secret");
  assert.throws(() => optionalStripeWebhookSecret("not-a-stripe-secret"), /STRIPE_WEBHOOK_SECRET/);
});
