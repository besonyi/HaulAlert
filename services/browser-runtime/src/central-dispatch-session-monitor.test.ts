import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BrowserRuntime } from "@haulalert/browser-runtime-core";

import { CentralDispatchSessionMonitor } from "./central-dispatch-session-monitor.js";
import type { ChromeDevToolsTarget } from "./central-dispatch-cdp-executor.js";

const target: ChromeDevToolsTarget = {
  id: "central-tab",
  type: "page",
  url: "https://app.centraldispatch.com/search",
  webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/central-tab"
};

function createBrowserRuntime(): BrowserRuntime {
  return new BrowserRuntime({ now: () => new Date("2026-09-24T12:00:00.000Z") });
}

describe("Central Dispatch session monitor", () => {
  it("registers and heartbeats the runtime session when the authenticated page is available", async () => {
    const runtime = createBrowserRuntime();
    const monitor = new CentralDispatchSessionMonitor(runtime, {
      findCentralDispatchTarget: async () => target,
      evaluateJson: async () => undefined
    }, "central-local");

    const result = await monitor.probe();

    assert.equal(result.status, "healthy");
    assert.deepEqual(result.session, {
      id: "central-local",
      provider: "central-dispatch",
      status: "healthy",
      createdAt: "2026-09-24T12:00:00.000Z",
      lastHeartbeatAt: "2026-09-24T12:00:00.000Z"
    });
  });

  it("takes existing scans offline when the local browser page cannot be reached", async () => {
    const runtime = createBrowserRuntime();
    runtime.registerSession({ id: "central-local", provider: "central-dispatch" });
    const reservation = runtime.reserveSearchTab({ provider: "central-dispatch", sourceFilterHash: "source-hash" });
    runtime.markTabReady(reservation.tab.id);
    const monitor = new CentralDispatchSessionMonitor(runtime, {
      findCentralDispatchTarget: async () => { throw new Error("No Central Dispatch tab"); },
      evaluateJson: async () => undefined
    }, "central-local");

    const result = await monitor.probe();

    assert.equal(result.status, "offline");
    assert.match(result.error?.message ?? "", /No Central Dispatch tab/);
    assert.equal(runtime.listScannableTabs().length, 0);
  });

  it("restores an offline session on a later successful probe", async () => {
    const runtime = createBrowserRuntime();
    runtime.registerSession({ id: "central-local", provider: "central-dispatch" });
    runtime.setSessionStatus("central-local", "offline");
    const monitor = new CentralDispatchSessionMonitor(runtime, {
      findCentralDispatchTarget: async () => target,
      evaluateJson: async () => undefined
    }, "central-local");

    const result = await monitor.probe();

    assert.equal(result.status, "healthy");
    assert.equal(result.session.lastHeartbeatAt, "2026-09-24T12:00:00.000Z");
  });
});
