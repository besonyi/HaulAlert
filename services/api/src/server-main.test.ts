import assert from "node:assert/strict";
import test from "node:test";

import { getTelegramBotUsername, optionalStripeWebhookSecret, withInviteLink } from "./server-main.js";

test("referral links use the configured Telegram bot username", () => {
  assert.equal(getTelegramBotUsername(undefined), "HaulAlertBot");
  assert.equal(getTelegramBotUsername("@CustomHaulBot"), "CustomHaulBot");
  assert.throws(() => getTelegramBotUsername("not valid"), /TELEGRAM_BOT_USERNAME/);
  assert.equal(withInviteLink({
    code: "A7K92D4F", totalInvited: 0, registered: 0, activePaid: 0, inactive: 0,
    monthlyCreditCents: 0, partnerProgressActivePaid: 0, partnerUnlockAt: 5, partnerStatus: "not_eligible"
  }, "CustomHaulBot").inviteLink, "https://t.me/CustomHaulBot?start=ref_A7K92D4F");
});

test("Stripe webhook endpoint is disabled until its endpoint secret is configured", () => {
  assert.equal(optionalStripeWebhookSecret(undefined), undefined);
  assert.equal(optionalStripeWebhookSecret(" whsec_configured_secret "), "whsec_configured_secret");
  assert.throws(() => optionalStripeWebhookSecret("not-a-stripe-secret"), /STRIPE_WEBHOOK_SECRET/);
});
