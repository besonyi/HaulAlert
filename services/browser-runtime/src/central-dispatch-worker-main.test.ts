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
    assert.equal(config.requestTimeoutMs, 15_000);
    assert.equal(config.healthPort, 3_010);
  });

  it("reads validated polling settings without reading browser credentials", () => {
    const config = getCentralDispatchWorkerRuntimeConfig({
      DATABASE_URL: "postgresql://localhost/haulalert",
      CENTRAL_DISPATCH_SESSION_ID: "office-chrome",
      CENTRAL_DISPATCH_DEVTOOLS_ENDPOINT: "http://127.0.0.1:9333",
      CENTRAL_DISPATCH_BATCH_SIZE: "3",
      CENTRAL_DISPATCH_POLL_INTERVAL_MS: "45000",
      CENTRAL_DISPATCH_ALERT_REFRESH_INTERVAL_MS: "9000",
      CENTRAL_DISPATCH_REQUEST_TIMEOUT_MS: "12000",
      CENTRAL_DISPATCH_HEALTH_PORT: "3011"
    });

    assert.equal(config.sessionId, "office-chrome");
    assert.equal(config.chromeDevToolsEndpoint, "http://127.0.0.1:9333");
    assert.equal(config.batchSize, 3);
    assert.equal(config.pollIntervalMs, 45_000);
    assert.equal(config.alertRefreshIntervalMs, 9_000);
    assert.equal(config.requestTimeoutMs, 12_000);
    assert.equal(config.healthPort, 3_011);
  });

  it("rejects unsafe polling values", () => {
    assert.throws(
      () => getCentralDispatchWorkerRuntimeConfig({ DATABASE_URL: "postgresql://localhost/haulalert", CENTRAL_DISPATCH_BATCH_SIZE: "0" }),
      /CENTRAL_DISPATCH_BATCH_SIZE must be a positive integer/
    );
  });

  it("rejects an invalid local health port", () => {
    assert.throws(
      () => getCentralDispatchWorkerRuntimeConfig({ DATABASE_URL: "postgresql://localhost/haulalert", CENTRAL_DISPATCH_HEALTH_PORT: "65536" }),
      /CENTRAL_DISPATCH_HEALTH_PORT must be an integer between 1 and 65535/
    );
  });

  it("rejects non-local, encrypted, credentialed, and malformed DevTools endpoints", () => {
    for (const endpoint of [
      "http://192.168.1.25:9222",
      "https://127.0.0.1:9222",
      "http://operator:secret@127.0.0.1:9222"
    ]) {
      assert.throws(
        () => getCentralDispatchWorkerRuntimeConfig({
          DATABASE_URL: "postgresql://localhost/haulalert",
          CENTRAL_DISPATCH_DEVTOOLS_ENDPOINT: endpoint
        }),
        /CENTRAL_DISPATCH_DEVTOOLS_ENDPOINT must use credential-free loopback HTTP/
      );
    }

    assert.throws(
      () => getCentralDispatchWorkerRuntimeConfig({
        DATABASE_URL: "postgresql://localhost/haulalert",
        CENTRAL_DISPATCH_DEVTOOLS_ENDPOINT: "not a URL"
      }),
      /CENTRAL_DISPATCH_DEVTOOLS_ENDPOINT must be a valid URL/
    );
  });
});
