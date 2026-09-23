import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCanonicalFilter } from "@haulalert/canonical-filter";
import type { NormalizedLoad } from "@haulalert/load-model";
import type { SqlExecutor } from "@haulalert/notification-service";

import {
  PostgresAlertSubscriptionSource,
  RefreshingAlertCandidateIndex,
  type ActiveAlertSubscriptionSource
} from "./postgres-alert-subscription-source.js";

const filter = parseCanonicalFilter({
  schemaVersion: 1,
  name: "Open loads",
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

describe("durable active alert source", () => {
  it("loads only active alerts with an established Telegram chat", async () => {
    let statement = "";
    const database: SqlExecutor = {
      query: async (query) => {
        statement = query;
        return {
          rows: [{
            alert_id: "alert-1",
            user_id: "user-1",
            telegram_chat_id: 123456,
            canonical_filter: JSON.stringify(filter)
          }]
        };
      }
    };

    const subscriptions = await new PostgresAlertSubscriptionSource(database).listActive();

    assert.match(statement, /a\.status = 'active'/);
    assert.match(statement, /telegram_chat_id IS NOT NULL/);
    assert.deepEqual(subscriptions[0], {
      alertId: "alert-1",
      userId: "user-1",
      telegramChatId: "123456",
      filter
    });
  });

  it("atomically refreshes the candidate index when the cache becomes stale", async () => {
    let calls = 0;
    const source: ActiveAlertSubscriptionSource = {
      listActive: async () => {
        calls += 1;
        return calls === 1 ? [{ alertId: "alert-1", userId: "user-1", telegramChatId: "chat-1", filter }] : [];
      }
    };
    const index = new RefreshingAlertCandidateIndex(source, 1_000);

    assert.equal((await index.findMatches(load, new Date("2026-09-23T12:00:00.000Z"))).length, 1);
    assert.equal((await index.findMatches(load, new Date("2026-09-23T12:00:00.500Z"))).length, 1);
    assert.equal((await index.findMatches(load, new Date("2026-09-23T12:00:01.000Z"))).length, 0);
    assert.equal(calls, 2);
  });
});
