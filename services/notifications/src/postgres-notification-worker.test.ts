import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ClaimedNotificationDelivery, DurableNotificationDeliveryRepository } from "./postgres-notification-delivery-repository.js";
import { PostgresNotificationWorker } from "./postgres-notification-worker.js";
import { TelegramRateLimitError } from "./telegram-bot-api-transport.js";
import type { TelegramTransport } from "./index.js";

const claimedDelivery: ClaimedNotificationDelivery = {
  deliveryId: "delivery-1",
  deliveryKey: "central-dispatch:829181:alert-1:user-1",
  attemptCount: 0,
  match: {
    alertId: "alert-1",
    userId: "user-1",
    telegramChatId: "telegram-1",
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
  }
};

class FakeRepository implements DurableNotificationDeliveryRepository {
  public markedSent: string[] = [];
  public retries: { deliveryId: string; nextAttemptAt: Date }[] = [];
  public deadLetters: string[] = [];

  public constructor(private readonly deliveries: readonly ClaimedNotificationDelivery[]) {}

  public async claimDue(): Promise<readonly ClaimedNotificationDelivery[]> {
    return this.deliveries;
  }

  public async markSent(deliveryId: string): Promise<boolean> {
    this.markedSent.push(deliveryId);
    return true;
  }

  public async scheduleRetry(
    deliveryId: string,
    _errorMessage: string,
    availableAt: Date
  ): Promise<boolean> {
    this.retries.push({ deliveryId, nextAttemptAt: availableAt });
    return true;
  }

  public async markDeadLetter(deliveryId: string): Promise<boolean> {
    this.deadLetters.push(deliveryId);
    return true;
  }
}

describe("PostgreSQL notification worker", () => {
  const now = new Date("2026-09-22T12:00:00.000Z");

  it("sends a claimed delivery and marks it sent", async () => {
    const repository = new FakeRepository([claimedDelivery]);
    const recipients: string[] = [];
    const transport: TelegramTransport = { send: async ({ recipientId }) => { recipients.push(recipientId); } };
    const worker = new PostgresNotificationWorker(repository, transport);

    assert.deepEqual(await worker.processBatch(10, { now }), [{ status: "sent", deliveryId: "delivery-1" }]);
    assert.deepEqual(recipients, ["telegram-1"]);
    assert.deepEqual(repository.markedSent, ["delivery-1"]);
  });

  it("schedules a Telegram rate-limit retry using the server delay", async () => {
    const repository = new FakeRepository([claimedDelivery]);
    const transport: TelegramTransport = {
      send: async () => { throw new TelegramRateLimitError(7_000); }
    };
    const worker = new PostgresNotificationWorker(repository, transport, {
      maximumAttempts: 3,
      initialRetryDelayMs: 100
    });

    const outcome = (await worker.processBatch(10, { now }))[0];
    assert.equal(outcome?.status, "retry-scheduled");
    assert.equal(repository.retries[0]?.nextAttemptAt.toISOString(), "2026-09-22T12:00:07.000Z");
  });

  it("does not resend a delivery whose database claim was lost after sending", async () => {
    const repository = new FakeRepository([claimedDelivery]);
    repository.markSent = async () => false;
    const transport: TelegramTransport = { send: async () => undefined };
    const worker = new PostgresNotificationWorker(repository, transport);

    assert.deepEqual(await worker.processBatch(10, { now }), [{ status: "lost-claim", deliveryId: "delivery-1" }]);
    assert.deepEqual(repository.retries, []);
  });
});
