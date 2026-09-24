import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getCentralDispatchWorkerRuntimeConfig } from "./central-dispatch-worker-main.js";

describe("Central Dispatch worker runtime config", () => {
  it("uses local, credential-free defaults", () => {
    const config = getCentralDispatchWorkerRuntimeConfig({ DATABASE_URL: "postgresql://localhost/haulalert" });

    assert.equal(config.sessionId, "central-dispatch-local");
    assert.equal(config.chromeDevToolsEndpoint, "http://127.0.0.1:9222");
    assert.equal(config.batchSize, 10);
    assert.equal(config.pollIntervalMs, 30_000);
  });

  it("reads validated polling settings without reading browser credentials", () => {
    const config = getCentralDispatchWorkerRuntimeConfig({
      DATABASE_URL: "postgresql://localhost/haulalert",
      CENTRAL_DISPATCH_SESSION_ID: "office-chrome",
      CENTRAL_DISPATCH_DEVTOOLS_ENDPOINT: "http://127.0.0.1:9333",
      CENTRAL_DISPATCH_BATCH_SIZE: "3",
      CENTRAL_DISPATCH_POLL_INTERVAL_MS: "45000",
      CENTRAL_DISPATCH_ALERT_REFRESH_INTERVAL_MS: "9000"
    });

    assert.equal(config.sessionId, "office-chrome");
    assert.equal(config.chromeDevToolsEndpoint, "http://127.0.0.1:9333");
    assert.equal(config.batchSize, 3);
    assert.equal(config.pollIntervalMs, 45_000);
    assert.equal(config.alertRefreshIntervalMs, 9_000);
  });

  it("rejects unsafe polling values", () => {
    assert.throws(
      () => getCentralDispatchWorkerRuntimeConfig({ DATABASE_URL: "postgresql://localhost/haulalert", CENTRAL_DISPATCH_BATCH_SIZE: "0" }),
      /CENTRAL_DISPATCH_BATCH_SIZE must be a positive integer/
    );
  });
});
