import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getNotificationWorkerRuntimeConfig } from "./worker-main.js";

const requiredEnvironment = {
  DATABASE_URL: "postgresql://user:password@localhost:5432/haulalert",
  TELEGRAM_BOT_TOKEN: "123:secret"
};

describe("notification worker runtime config", () => {
  it("uses safe runtime defaults", () => {
    assert.deepEqual(getNotificationWorkerRuntimeConfig(requiredEnvironment), {
      databaseUrl: "postgresql://user:password@localhost:5432/haulalert",
      telegramBotToken: "123:secret",
      batchSize: 25,
      pollIntervalMs: 1_000,
      maximumAttempts: 3,
      initialRetryDelayMs: 5_000
    });
  });

  it("reads validated worker tuning from the environment", () => {
    const config = getNotificationWorkerRuntimeConfig({
      ...requiredEnvironment,
      NOTIFICATION_WORKER_BATCH_SIZE: "10",
      NOTIFICATION_WORKER_POLL_INTERVAL_MS: "250",
      NOTIFICATION_WORKER_MAXIMUM_ATTEMPTS: "5",
      NOTIFICATION_WORKER_INITIAL_RETRY_DELAY_MS: "750"
    });

    assert.deepEqual({
      batchSize: config.batchSize,
      pollIntervalMs: config.pollIntervalMs,
      maximumAttempts: config.maximumAttempts,
      initialRetryDelayMs: config.initialRetryDelayMs
    }, {
      batchSize: 10,
      pollIntervalMs: 250,
      maximumAttempts: 5,
      initialRetryDelayMs: 750
    });
  });

  it("rejects invalid worker tuning", () => {
    assert.throws(
      () => getNotificationWorkerRuntimeConfig({ ...requiredEnvironment, NOTIFICATION_WORKER_BATCH_SIZE: "0" }),
      /NOTIFICATION_WORKER_BATCH_SIZE/
    );
  });
});
