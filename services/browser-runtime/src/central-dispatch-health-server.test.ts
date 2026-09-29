import assert from "node:assert/strict";
import { once } from "node:events";
import { describe, it } from "node:test";

import { CentralDispatchRuntimeHealth, createCentralDispatchHealthServer } from "./central-dispatch-health-server.js";

describe("Central Dispatch local health server", () => {
  it("keeps browser-runtime readiness separate from process liveness", async () => {
    const health = new CentralDispatchRuntimeHealth();
    const server = createCentralDispatchHealthServer(health);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Expected local TCP address");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const liveness = await fetch(`${baseUrl}/healthz`);
      assert.equal(liveness.status, 200);
      assert.deepEqual(await liveness.json(), { status: "ok" });
      assert.equal(liveness.headers.get("cache-control"), "no-store");
      assert.equal(liveness.headers.get("x-frame-options"), "DENY");

      assert.deepEqual(await (await fetch(`${baseUrl}/readyz`)).json(), { status: "unavailable" });
      health.reportSession("healthy");
      assert.deepEqual(await (await fetch(`${baseUrl}/readyz`)).json(), { status: "ready" });
      health.reportCycleFailure();
      const unavailable = await fetch(`${baseUrl}/readyz`);
      assert.equal(unavailable.status, 503);
      assert.deepEqual(await unavailable.json(), { status: "unavailable" });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it("rejects unsupported methods and paths without exposing runtime state", async () => {
    const server = createCentralDispatchHealthServer(new CentralDispatchRuntimeHealth());
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Expected local TCP address");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      assert.equal((await fetch(`${baseUrl}/healthz`, { method: "POST" })).status, 405);
      assert.equal((await fetch(`${baseUrl}/unrelated`)).status, 404);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });
});
