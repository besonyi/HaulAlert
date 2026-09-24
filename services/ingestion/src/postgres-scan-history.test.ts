import assert from "node:assert/strict";
import test from "node:test";

import type { SqlExecutor } from "@haulalert/notification-service";

import { PostgresScanHistoryRecorder } from "./postgres-scan-history.js";

test("Postgres scan history records the durable new-load decision", async () => {
  let captured: { statement: string; parameters: readonly unknown[] } | undefined;
  const database: SqlExecutor = {
    query: async (statement, parameters) => {
      captured = { statement, parameters };
      return { rows: [] };
    }
  };
  const startedAt = new Date("2026-09-23T12:00:00.000Z");
  const completedAt = new Date("2026-09-23T12:00:04.000Z");

  await new PostgresScanHistoryRecorder(database).record({
    providerSearchId: "11111111-1111-4111-8111-111111111111",
    scan: { searchId: "central:filter-hash", loads: [], isTruncated: true },
    startedAt,
    completedAt
  }, {
    newLoads: [],
    seeded: false,
    boundaryFound: false,
    overflowRisk: true
  });

  assert.match(captured?.statement ?? "", /INSERT INTO provider_scans/);
  assert.deepEqual(captured?.parameters, [
    "11111111-1111-4111-8111-111111111111",
    startedAt.toISOString(),
    completedAt.toISOString(),
    0,
    0,
    false,
    true
  ]);
});

test("Postgres scan history stores only a safe classification for a failed scan", async () => {
  let captured: { statement: string; parameters: readonly unknown[] } | undefined;
  const database: SqlExecutor = {
    query: async (statement, parameters) => {
      captured = { statement, parameters };
      return { rows: [] };
    }
  };
  const startedAt = new Date("2026-09-23T12:00:00.000Z");
  const completedAt = new Date("2026-09-23T12:00:04.000Z");

  await new PostgresScanHistoryRecorder(database).recordFailure({
    providerSearchId: "11111111-1111-4111-8111-111111111111",
    startedAt,
    completedAt,
    errorCode: "central-dispatch-tab-not-found"
  });

  assert.match(captured?.statement ?? "", /error_code/);
  assert.deepEqual(captured?.parameters, [
    "11111111-1111-4111-8111-111111111111",
    startedAt.toISOString(),
    completedAt.toISOString(),
    "central-dispatch-tab-not-found"
  ]);
});
