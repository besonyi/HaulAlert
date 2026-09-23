import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TelegramWebhookHandler,
  getTelegramWebhookSecret,
  type TelegramUpdateHandler
} from "./webhook.js";

describe("Telegram webhook handler", () => {
  const secret = "at-least-sixteen-characters";

  it("passes an authenticated private /start update to onboarding", async () => {
    const updates: unknown[] = [];
    const handler = new TelegramWebhookHandler(secret, {
      handle: async (update) => { updates.push(update); }
    });

    assert.deepEqual(await handler.handle({
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": secret },
      body: JSON.stringify({
        update_id: 1,
        message: {
          text: "/start",
          from: { id: 12345, is_bot: false },
          chat: { id: 12345, type: "private" }
        }
      })
    }), { statusCode: 200 });
    assert.deepEqual(updates, [{
      message: {
        text: "/start",
        from: { id: 12345, isBot: false },
        chat: { id: 12345, type: "private" }
      }
    }]);
  });

  it("rejects requests with a missing or invalid secret before handling them", async () => {
    let handled = false;
    const updates: TelegramUpdateHandler = { handle: async () => { handled = true; } };
    const handler = new TelegramWebhookHandler(secret, updates);

    assert.deepEqual(await handler.handle({ method: "POST", headers: {}, body: "{}" }), { statusCode: 401 });
    assert.deepEqual(await handler.handle({
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "incorrect-secret-value" },
      body: "{}"
    }), { statusCode: 401 });
    assert.equal(handled, false);
  });

  it("rejects invalid methods and malformed JSON", async () => {
    const handler = new TelegramWebhookHandler(secret, { handle: async () => undefined });

    assert.deepEqual(await handler.handle({ method: "GET", headers: {}, body: "" }), { statusCode: 405 });
    assert.deepEqual(await handler.handle({
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": secret },
      body: "{"
    }), { statusCode: 400 });
  });

  it("requires a sufficiently long configured webhook secret", () => {
    assert.throws(() => getTelegramWebhookSecret({}), /TELEGRAM_WEBHOOK_SECRET/);
    assert.throws(() => getTelegramWebhookSecret({ TELEGRAM_WEBHOOK_SECRET: "too-short" }), /16/);
    assert.equal(getTelegramWebhookSecret({ TELEGRAM_WEBHOOK_SECRET: secret }), secret);
  });
});
