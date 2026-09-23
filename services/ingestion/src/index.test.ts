import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AlertCandidateIndex } from "@haulalert/alert-matcher";
import { parseCanonicalFilter } from "@haulalert/canonical-filter";
import type { NormalizedLoad } from "@haulalert/load-model";
import type { DurableNotificationDeliveryEnqueuer, SqlExecutor } from "@haulalert/notification-service";

import { DurableLoadIngestionService, PostgresLoadRepository, type LoadPersistence } from "./index.js";

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

describe("durable load ingestion", () => {
  it("updates an existing load observation without making a duplicate event", async () => {
    const statements: string[] = [];
    const database: SqlExecutor = {
      query: async (statement) => {
        statements.push(statement);
        return { rows: [] };
      }
    };
    const repository = new PostgresLoadRepository(database);

    assert.deepEqual(await repository.record(load, new Date("2026-09-22T12:00:00.000Z")), { isNew: false });
    assert.match(statements[0] ?? "", /ON CONFLICT/);
    assert.match(statements[1] ?? "", /UPDATE loads/);
  });

  it("queues only matches for a newly persisted load", async () => {
    const index = new AlertCandidateIndex();
    index.upsert({ alertId: "alert-1", userId: "user-1", telegramChatId: "chat-1", filter });
    const persistence: LoadPersistence = { record: async () => ({ isNew: true }) };
    const queuedAlertIds: string[] = [];
    const deliveries: DurableNotificationDeliveryEnqueuer = {
      enqueue: async (match) => {
        queuedAlertIds.push(match.alertId);
        return { status: "queued", deliveryId: "delivery-1", deliveryKey: "key-1" };
      }
    };
    const service = new DurableLoadIngestionService(persistence, index, deliveries);

    const result = await service.ingest(load, new Date("2026-09-22T12:00:00.000Z"));

    assert.equal(result.status, "new");
    assert.deepEqual(queuedAlertIds, ["alert-1"]);
    assert.deepEqual(result.status === "new" && result.deliveries.map(({ status }) => status), ["queued"]);
  });

  it("does not queue a load that was already globally observed", async () => {
    const persistence: LoadPersistence = { record: async () => ({ isNew: false }) };
    const deliveries: DurableNotificationDeliveryEnqueuer = {
      enqueue: async () => { throw new Error("should not enqueue"); }
    };
    const service = new DurableLoadIngestionService(persistence, new AlertCandidateIndex(), deliveries);

    assert.equal((await service.ingest(load)).status, "known");
  });
});
