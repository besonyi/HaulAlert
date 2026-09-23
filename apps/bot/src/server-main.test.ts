import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { createTelegramWebhookServer, getBotServerConfig } from "./server-main.js";
import type { TelegramWebhookRequest } from "./webhook.js";

test("HTTP server forwards only the configured webhook path to the handler", async () => {
  const received: TelegramWebhookRequest[] = [];
  const server = createTelegramWebhookServer(
    {
      async handle(request) {
        received.push(request);
        return { statusCode: 200 };
      }
    },
    "/telegram/webhook"
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Expected a TCP server address");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const accepted = await fetch(`${baseUrl}/telegram/webhook`, {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "correct-secret" },
      body: "{}"
    });
    assert.equal(accepted.status, 200);
    assert.equal(received.length, 1);
    assert.equal(received[0]?.method, "POST");
    assert.equal(received[0]?.body, "{}");
    assert.equal(received[0]?.headers["x-telegram-bot-api-secret-token"], "correct-secret");

    const unknown = await fetch(`${baseUrl}/not-a-webhook`, { method: "POST", body: "{}" });
    assert.equal(unknown.status, 404);
    assert.equal(received.length, 1);
  } finally {
    await new Promise<void>((resolveClosing, reject) => {
      server.close((error) => error === undefined ? resolveClosing() : reject(error));
    });
  }
});

test("Bot server configuration validates its public HTTP settings", () => {
  const configuration = getBotServerConfig({
    DATABASE_URL: "postgresql://example",
    TELEGRAM_BOT_TOKEN: "token",
    TELEGRAM_WEBHOOK_SECRET: "a-secure-webhook-secret",
    TELEGRAM_WEBHOOK_PATH: "/incoming/telegram",
    PORT: "8080"
  });
  assert.equal(configuration.port, 8080);
  assert.equal(configuration.webhookPath, "/incoming/telegram");

  assert.throws(
    () => getBotServerConfig({
      DATABASE_URL: "postgresql://example",
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_WEBHOOK_SECRET: "a-secure-webhook-secret",
      PORT: "0"
    }),
    /PORT must be an integer/
  );
});
