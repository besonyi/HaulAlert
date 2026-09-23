import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AlertCandidateIndex } from "@haulalert/alert-matcher";
import { parseCanonicalFilter } from "@haulalert/canonical-filter";
import type { NormalizedLoad } from "@haulalert/load-model";
import {
  InMemoryNotificationDeliveryStore,
  NotificationService,
  type TelegramTransport
} from "@haulalert/notification-service";

import { LoadMatchProcessor } from "./index.js";

const filter = parseCanonicalFilter({
  schemaVersion: 1,
  name: "Arizona route",
  origins: [{ kind: "anywhere" }],
  destinations: [{ kind: "anywhere" }],
  trailerTypes: ["open"],
  vehicles: { minimum: null, maximum: null },
  readiness: { kind: "any" },
  minimumPayUsd: null,
  minimumRatePerMile: null,
  providers: ["central-dispatch"],
  blockedBrokerIds: []
});

const load: NormalizedLoad = {
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
};

describe("load match processor", () => {
  it("delivers every exact match and isolates a failed customer delivery", async () => {
    const index = new AlertCandidateIndex();
    index.upsert({
      alertId: "alert-fails",
      userId: "user-fails",
      telegramChatId: "telegram-fails",
      filter
    });
    index.upsert({
      alertId: "alert-sends",
      userId: "user-sends",
      telegramChatId: "telegram-sends",
      filter
    });
    const sent: string[] = [];
    const transport: TelegramTransport = {
      send: async ({ recipientId }) => {
        if (recipientId === "telegram-fails") throw new Error("Bot blocked by user");
        sent.push(recipientId);
      }
    };
    const processor = new LoadMatchProcessor(
      index,
      new NotificationService(transport, new InMemoryNotificationDeliveryStore())
    );

    const result = await processor.process(load, {
      getLoadDetailsUrl: (match) => `https://app.haulalert.example/loads/${match.load.providerLoadId}`
    });

    assert.deepEqual(result.matches.map(({ alertId }) => alertId), ["alert-fails", "alert-sends"]);
    assert.deepEqual(result.deliveries.map(({ status }) => status), ["failed", "delivered"]);
    assert.equal(result.deliveries[0]?.status === "failed" && result.deliveries[0].error.message, "Bot blocked by user");
    assert.deepEqual(sent, ["telegram-sends"]);
  });
});
