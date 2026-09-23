import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AlertMatch } from "@haulalert/alert-matcher";

import {
  InMemoryNotificationDeliveryStore,
  NotificationService,
  type TelegramTransport
} from "./index.js";

function createMatch(): AlertMatch {
  return {
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
  };
}

describe("notification service", () => {
  it("sends a matching load once per alert and user", async () => {
    const sent: string[] = [];
    const transport: TelegramTransport = {
      send: async ({ recipientId }) => {
        sent.push(recipientId);
      }
    };
    const service = new NotificationService(transport, new InMemoryNotificationDeliveryStore());
    const match = createMatch();

    const first = await service.deliverNewLoad(match);
    const second = await service.deliverNewLoad(match);

    assert.equal(first.status, "sent");
    assert.equal(second.status, "duplicate");
    assert.equal(first.deliveryKey, "central-dispatch:829181:alert-1:user-1");
    assert.deepEqual(sent, ["telegram-1"]);
  });

  it("does not record a failed delivery, allowing a safe retry", async () => {
    let attempts = 0;
    const transport: TelegramTransport = {
      send: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("Temporary Telegram failure");
      }
    };
    const service = new NotificationService(transport, new InMemoryNotificationDeliveryStore());
    const match = createMatch();

    await assert.rejects(() => service.deliverNewLoad(match), /Temporary Telegram failure/);
    assert.equal((await service.deliverNewLoad(match)).status, "sent");
    assert.equal(attempts, 2);
  });

  it("reserves a delivery while Telegram is still sending it", async () => {
    let allowSend: (() => void) | undefined;
    let markSendStarted: (() => void) | undefined;
    const sendStarted = new Promise<void>((resolve) => {
      markSendStarted = resolve;
    });
    const transport: TelegramTransport = {
      send: async () => {
        markSendStarted?.();
        await new Promise<void>((resolve) => {
          allowSend = resolve;
        });
      }
    };
    const service = new NotificationService(transport, new InMemoryNotificationDeliveryStore());
    const match = createMatch();

    const firstDelivery = service.deliverNewLoad(match);
    await sendStarted;

    assert.equal((await service.deliverNewLoad(match)).status, "in-flight");
    allowSend?.();
    assert.equal((await firstDelivery).status, "sent");
    assert.equal((await service.deliverNewLoad(match)).status, "duplicate");
  });
});
