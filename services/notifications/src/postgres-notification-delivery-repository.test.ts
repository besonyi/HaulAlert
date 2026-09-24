import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AlertMatch } from "@haulalert/alert-matcher";

import {
  PostgresNotificationDeliveryRepository,
  type SqlExecutor
} from "./postgres-notification-delivery-repository.js";

const match: AlertMatch = {
  alertId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  telegramChatId: "123456",
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

describe("PostgreSQL notification delivery repository", () => {
  it("creates one durable delivery after resolving the persisted load", async () => {
    const calls: { statement: string; parameters: readonly unknown[] }[] = [];
    const database: SqlExecutor = {
      query: async (statement, parameters) => {
        calls.push({ statement, parameters });
        return calls.length === 1
          ? { rows: [{ id: "33333333-3333-4333-8333-333333333333" }] }
          : { rows: [{ id: "44444444-4444-4444-8444-444444444444" }] };
      }
    };
    const repository = new PostgresNotificationDeliveryRepository(database);

    const result = await repository.enqueue(match, new Date("2026-09-22T12:00:00.000Z"));

    assert.deepEqual(result, {
      status: "queued",
      deliveryId: "44444444-4444-4444-8444-444444444444",
      deliveryKey: "central-dispatch:829181:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222"
    });
    assert.match(calls[0]?.statement ?? "", /FROM loads/);
    assert.deepEqual(calls[0]?.parameters, ["central-dispatch", "829181"]);
    assert.match(calls[1]?.statement ?? "", /ON CONFLICT \(delivery_key\) DO NOTHING/);
  });

  it("claims ready jobs with SKIP LOCKED and rebuilds a safe alert match", async () => {
    let statement = "";
    const database: SqlExecutor = {
      query: async (captured) => {
        statement = captured;
        return {
          rows: [{
            id: "44444444-4444-4444-8444-444444444444",
            delivery_key: "central-dispatch:829181:alert:user",
            attempt_count: 1,
            alert_id: match.alertId,
            user_id: match.userId,
            telegram_chat_id: 123456,
            normalized_load: match.load
          }]
        };
      }
    };
    const repository = new PostgresNotificationDeliveryRepository(database);

    const deliveries = await repository.claimDue(10, new Date("2026-09-22T12:00:00.000Z"));

    assert.equal(deliveries[0]?.match.telegramChatId, "123456");
    assert.equal(deliveries[0]?.match.load.providerLoadId, "829181");
    assert.match(statement, /status = 'cancelled'/);
    assert.match(statement, /Alert is no longer active/);
    assert.match(statement, /alert.status = 'active'/);
    assert.match(statement, /FOR UPDATE SKIP LOCKED/);
  });

  it("reclaims expired worker leases and records their recovered attempts", async () => {
    let captured: { statement: string; parameters: readonly unknown[] } | undefined;
    const database: SqlExecutor = {
      query: async (statement, parameters) => {
        captured = { statement, parameters };
        return { rows: [{ retry_scheduled_count: "2", dead_letter_count: "1" }] };
      }
    };
    const repository = new PostgresNotificationDeliveryRepository(database);

    const recovered = await repository.reclaimExpiredClaims(60_000, 3, new Date("2026-09-23T12:00:00.000Z"));

    assert.deepEqual(recovered, { retryScheduled: 2, deadLettered: 1 });
    assert.match(captured?.statement ?? "", /status = 'delivering'/);
    assert.match(captured?.statement ?? "", /Delivery claim lease expired/);
    assert.match(captured?.statement ?? "", /notification_attempts/);
    assert.deepEqual(captured?.parameters, ["2026-09-23T12:00:00.000Z", 60_000, 3]);
  });

  it("records a successful transition only from the claimed state", async () => {
    let capturedStatement = "";
    const database: SqlExecutor = {
      query: async (statement) => {
        capturedStatement = statement;
        return { rows: [{ delivery_id: "44444444-4444-4444-8444-444444444444" }] };
      }
    };
    const repository = new PostgresNotificationDeliveryRepository(database);

    assert.equal(await repository.markSent("44444444-4444-4444-8444-444444444444", "99"), true);
    assert.match(capturedStatement, /status = 'delivering'/);
    assert.match(capturedStatement, /INSERT INTO notification_attempts/);
  });
});
