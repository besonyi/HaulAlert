import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getTelegramBotToken,
  TelegramBotApiTransport
} from "./telegram-bot-api-transport.js";

describe("Telegram Bot API transport", () => {
  it("sends a plain-text notification with an inline load action", async () => {
    let request: Request | undefined;
    const transport = new TelegramBotApiTransport("test-token", async (input, init) => {
      request = new Request(input, init);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    });

    await transport.send({
      recipientId: "12345",
      notification: {
        text: "🚨 NEW LOAD",
        actions: [{ label: "OPEN LOAD", url: "https://app.haulalert.example/loads/1" }]
      }
    });

    assert.equal(request?.url, "https://api.telegram.org/bottest-token/sendMessage");
    assert.equal(request?.method, "POST");
    assert.deepEqual(await request?.json(), {
      chat_id: "12345",
      text: "🚨 NEW LOAD",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: "OPEN LOAD", url: "https://app.haulalert.example/loads/1" }]]
      }
    });
  });

  it("exposes Telegram's error description when the API rejects a message", async () => {
    const transport = new TelegramBotApiTransport("test-token", async () => (
      new Response(JSON.stringify({ ok: false, description: "Forbidden: bot was blocked by the user" }), { status: 200 })
    ));

    await assert.rejects(
      () => transport.send({ recipientId: "12345", notification: { text: "test", actions: [] } }),
      /bot was blocked/
    );
  });

  it("requires an explicitly configured bot token", () => {
    assert.throws(() => getTelegramBotToken({}), /TELEGRAM_BOT_TOKEN/);
    assert.equal(getTelegramBotToken({ TELEGRAM_BOT_TOKEN: " 123:secret " }), "123:secret");
  });
});
