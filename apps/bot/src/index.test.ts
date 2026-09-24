import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SqlExecutor } from "@haulalert/notification-service";

import {
  PostgresTelegramIdentityStore,
  TelegramBotOnboardingService,
  PostgresAlertMuteStore,
  type TelegramIdentityStore,
  type TelegramTextTransport
} from "./index.js";

describe("Telegram Bot onboarding", () => {
  it("onboards a private /start message and sends the welcome text", async () => {
    const identities: TelegramIdentityStore = {
      upsert: async () => ({ userId: "user-1", isNew: true })
    };
    const messages: { recipientId: string; text: string }[] = [];
    const transport: TelegramTextTransport = {
      sendText: async (recipientId, text) => { messages.push({ recipientId, text }); }
    };
    const service = new TelegramBotOnboardingService(identities, transport);

    assert.deepEqual(await service.handle({
      message: { text: "/start", from: { id: 12345 }, chat: { id: 12345, type: "private" } }
    }), { status: "onboarded", userId: "user-1", isNew: true });
    assert.deepEqual(messages, [{
      recipientId: "12345",
      text: "Welcome to HaulAlert. You are connected — create an alert and we will message you when a matching load appears."
    }]);
  });

  it("ignores non-private messages and non-start commands", async () => {
    const service = new TelegramBotOnboardingService(
      { upsert: async () => ({ userId: "user-1", isNew: true }) },
      { sendText: async () => undefined }
    );

    assert.deepEqual(await service.handle({
      message: { text: "/start", from: { id: 1 }, chat: { id: -1, type: "group" } }
    }), { status: "ignored" });
    assert.deepEqual(await service.handle({
      message: { text: "/help", from: { id: 1 }, chat: { id: 1, type: "private" } }
    }), { status: "ignored" });
  });

  it("inserts a first-time Telegram identity and updates a returning chat", async () => {
    const statements: string[] = [];
    const database: SqlExecutor = {
      query: async (statement) => {
        statements.push(statement);
        return statements.length === 1 ? { rows: [] } : { rows: [{ id: "user-1" }] };
      }
    };
    const store = new PostgresTelegramIdentityStore(database);

    assert.deepEqual(await store.upsert({ telegramUserId: "1", telegramChatId: "2" }), {
      userId: "user-1",
      isNew: false
    });
    assert.match(statements[0] ?? "", /ON CONFLICT/);
    assert.match(statements[1] ?? "", /UPDATE users/);
  });

  it("pauses only the alert owned by the Telegram user who pressed mute", async () => {
    const calls: Array<readonly unknown[]> = [];
    const database: SqlExecutor = {
      query: async (_statement, values) => {
        calls.push(values ?? []);
        return { rows: [{ id: "alert-1" }] };
      }
    };
    const acknowledgements: string[] = [];
    const texts: string[] = [];
    const service = new TelegramBotOnboardingService(
      { upsert: async () => ({ userId: "user-1", isNew: false }) },
      {
        sendText: async (_recipient, text) => { texts.push(text); },
        answerCallbackQuery: async (_id, text) => { acknowledgements.push(text); }
      },
      new PostgresAlertMuteStore(database)
    );

    assert.deepEqual(await service.handle({
      callbackQuery: {
        id: "callback-1",
        data: "mute:123e4567-e89b-42d3-a456-426614174000",
        from: { id: 12345 },
        chat: { id: 12345, type: "private" }
      }
    }), { status: "muted" });
    assert.deepEqual(calls, [["12345", "123e4567-e89b-42d3-a456-426614174000"]]);
    assert.deepEqual(acknowledgements, ["Alert paused."]);
    assert.match(texts[0] ?? "", /Alert paused/);
  });
});
