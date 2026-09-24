import assert from "node:assert/strict";
import test from "node:test";

import type { AlertMatch } from "@haulalert/alert-matcher";
import type { NormalizedLoad } from "@haulalert/load-model";
import type { SqlExecutor } from "@haulalert/notification-service";

import { PostgresLoadDeliveryOutbox } from "./postgres-load-delivery-outbox.js";

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

const match: AlertMatch = {
  alertId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  telegramChatId: "123456",
  load
};

test("transactional outbox inserts a new load and its deliveries in one SQL statement", async () => {
  const calls: { statement: string; parameters: readonly unknown[] }[] = [];
  const database: SqlExecutor = {
    query: async (statement, parameters) => {
      calls.push({ statement, parameters });
      return { rows: [{
        load_id: "33333333-3333-4333-8333-333333333333",
        delivery_id: "44444444-4444-4444-8444-444444444444",
        delivery_key: "central-dispatch:829181:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222"
      }] };
    }
  };

  const result = await new PostgresLoadDeliveryOutbox(database).persist(match.load, [match], new Date("2026-09-23T12:00:00.000Z"));

  assert.deepEqual(result, {
    isNew: true,
    queuedDeliveries: [{
      deliveryId: "44444444-4444-4444-8444-444444444444",
      deliveryKey: "central-dispatch:829181:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222"
    }]
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0]?.statement ?? "", /WITH inserted_load/);
  assert.match(calls[0]?.statement ?? "", /INSERT INTO notification_deliveries/);
  assert.match(calls[0]?.statement ?? "", /jsonb_to_recordset/);
});

test("transactional outbox updates an existing observation without recreating deliveries", async () => {
  const statements: string[] = [];
  const database: SqlExecutor = {
    query: async (statement) => {
      statements.push(statement);
      return { rows: [{ load_id: null, delivery_id: null, delivery_key: null }] };
    }
  };

  const result = await new PostgresLoadDeliveryOutbox(database).persist(load, [match]);

  assert.deepEqual(result, { isNew: false, queuedDeliveries: [] });
  assert.match(statements[1] ?? "", /UPDATE loads/);
});
