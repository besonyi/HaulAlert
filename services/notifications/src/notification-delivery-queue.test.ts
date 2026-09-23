import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AlertMatch } from "@haulalert/alert-matcher";

import {
  InMemoryNotificationDeliveryQueue,
  InMemoryNotificationDeliveryStore,
  NotificationService,
  type TelegramTransport
} from "./index.js";

function createMatch(): AlertMatch {
  return {
    alertId: "alert-1",
    userId: "telegram-1",
    load: {
      provider: "central-dispatch",
      providerLoadId: "829181",
      pickup: { city: "Stockton", state: "CA", postalCode: null, coordinates: null },
      delivery: { city: "Phoenix", state: "AZ", postalCode: null, coordinates: null },
      vehicleCount: 3,
      trailerType: "open",
      payUsd: 2100,
      distanceMiles: 730,
      ratePerMile: 2.88,
      readyAt: null,
      postedAt: null,
      sourceUrl: null,
      broker: null
    }
  };
}

describe("notification delivery queue", () => {
  const startedAt = new Date("2026-09-22T12:00:00.000Z");

  it("retries a temporary Telegram error using exponential backoff", async () => {
    let attempts = 0;
    const transport: TelegramTransport = {
      send: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("Temporary Telegram failure");
      }
    };
    const queue = new InMemoryNotificationDeliveryQueue(
      new NotificationService(transport, new InMemoryNotificationDeliveryStore()),
      { maximumAttempts: 3, initialRetryDelayMs: 100 }
    );
    assert.equal(queue.enqueue(createMatch(), {}, startedAt), true);
    assert.equal(queue.enqueue(createMatch(), {}, startedAt), false);

    const first = await queue.processDue(startedAt);
    assert.equal(first[0]?.status, "retry-scheduled");
    assert.equal((await queue.processDue(new Date(startedAt.getTime() + 99))).length, 0);
    assert.equal((await queue.processDue(new Date(startedAt.getTime() + 100)))[0]?.status, "completed");
    assert.equal(queue.size, 0);
    assert.equal(attempts, 2);
  });

  it("preserves an exhausted delivery in the dead-letter list", async () => {
    const transport: TelegramTransport = { send: async () => { throw new Error("Bot blocked"); } };
    const queue = new InMemoryNotificationDeliveryQueue(
      new NotificationService(transport, new InMemoryNotificationDeliveryStore()),
      { maximumAttempts: 2, initialRetryDelayMs: 1 }
    );
    queue.enqueue(createMatch(), {}, startedAt);

    assert.equal((await queue.processDue(startedAt))[0]?.status, "retry-scheduled");
    assert.equal((await queue.processDue(new Date(startedAt.getTime() + 1)))[0]?.status, "dead-letter");
    assert.equal(queue.size, 0);
    assert.equal(queue.deadLetters[0]?.status, "dead-letter");
  });
});
