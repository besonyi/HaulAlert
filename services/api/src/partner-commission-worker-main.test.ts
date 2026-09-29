import assert from "node:assert/strict";
import test from "node:test";

import { getPartnerCommissionWorkerRuntimeConfig } from "./partner-commission-worker-main.js";

test("partner commission worker defaults to an hourly, bounded release cycle", () => {
  assert.deepEqual(getPartnerCommissionWorkerRuntimeConfig({ DATABASE_URL: "postgresql://localhost/haulalert" }), {
    databaseUrl: "postgresql://localhost/haulalert", batchSize: 100, pollIntervalMs: 3_600_000
  });
});

test("partner commission worker validates its release settings", () => {
  assert.throws(() => getPartnerCommissionWorkerRuntimeConfig({ DATABASE_URL: "postgresql://localhost/haulalert", PARTNER_COMMISSION_WORKER_BATCH_SIZE: "0" }), /BATCH_SIZE/);
  assert.throws(() => getPartnerCommissionWorkerRuntimeConfig({ DATABASE_URL: "postgresql://localhost/haulalert", PARTNER_COMMISSION_WORKER_POLL_INTERVAL_MS: "no" }), /POLL_INTERVAL_MS/);
});
