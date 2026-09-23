import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SqlExecutor } from "@haulalert/notification-service";

import { PostgresAlertRepository } from "./index.js";

const filter = {
  schemaVersion: 1,
  name: "California to Arizona",
  origins: [{ kind: "state", state: "CA" }],
  destinations: [{ kind: "state", state: "AZ" }],
  trailerTypes: ["open"],
  vehicles: { minimum: 1, maximum: 3 },
  readiness: { kind: "any" },
  minimumPayUsd: null,
  minimumRatePerMile: null,
  providers: ["central-dispatch"],
  blockedBrokerIds: []
};

const alertRow = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "22222222-2222-4222-8222-222222222222",
  name: filter.name,
  status: "active",
  canonical_filter: filter,
  created_at: "2026-09-23T12:00:00.000Z",
  updated_at: "2026-09-23T12:00:00.000Z"
};

describe("Postgres alert repository", () => {
  it("validates and creates a customer alert", async () => {
    const calls: { statement: string; parameters: readonly unknown[] }[] = [];
    const database: SqlExecutor = {
      query: async (statement, parameters) => {
        calls.push({ statement, parameters });
        return { rows: [alertRow] };
      }
    };

    const alert = await new PostgresAlertRepository(database).create({
      userId: alertRow.user_id,
      filter
    });

    assert.equal(alert.id, alertRow.id);
    assert.equal(alert.filter.name, filter.name);
    assert.match(calls[0]?.statement ?? "", /INSERT INTO alerts/);
    assert.deepEqual(calls[0]?.parameters, [alertRow.user_id, filter.name, JSON.stringify(filter)]);
  });

  it("limits reads and mutations to the owning user while excluding deleted alerts", async () => {
    const calls: { statement: string; parameters: readonly unknown[] }[] = [];
    const database: SqlExecutor = {
      query: async (statement, parameters) => {
        calls.push({ statement, parameters });
        if (statement.includes("SELECT id")) return { rows: [alertRow] };
        if (statement.includes("RETURNING id")) return { rows: [{ id: alertRow.id }] };
        return { rows: [] };
      }
    };
    const repository = new PostgresAlertRepository(database);

    assert.equal((await repository.listForUser(alertRow.user_id)).length, 1);
    assert.equal(await repository.remove(alertRow.id, alertRow.user_id), true);

    assert.match(calls[0]?.statement ?? "", /user_id = \$1::uuid/);
    assert.match(calls[0]?.statement ?? "", /status IN \('active', 'paused'\)/);
    assert.match(calls[1]?.statement ?? "", /status = 'deleted'/);
    assert.deepEqual(calls[1]?.parameters, [alertRow.id, alertRow.user_id]);
  });

  it("duplicates the filter under a new name without resurrecting deleted alerts", async () => {
    let captured: { statement: string; parameters: readonly unknown[] } | undefined;
    const database: SqlExecutor = {
      query: async (statement, parameters) => {
        captured = { statement, parameters };
        return { rows: [{ ...alertRow, id: "33333333-3333-4333-8333-333333333333", name: "Evening route", canonical_filter: { ...filter, name: "Evening route" } }] };
      }
    };

    const duplicate = await new PostgresAlertRepository(database).duplicate(
      alertRow.id,
      alertRow.user_id,
      " Evening route "
    );

    assert.equal(duplicate?.name, "Evening route");
    assert.match(captured?.statement ?? "", /jsonb_set/);
    assert.match(captured?.statement ?? "", /status IN \('active', 'paused'\)/);
    assert.deepEqual(captured?.parameters, [alertRow.id, alertRow.user_id, "Evening route"]);
  });
});
