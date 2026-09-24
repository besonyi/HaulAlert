import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BrowserRuntime, ScanScheduler } from "@haulalert/browser-runtime-core";

import { BrowserScanCoordinator, DurableBrowserRuntimeController, type BrowserRuntimeSnapshotStore } from "./index.js";
import { CentralDispatchRuntimeCycle } from "./central-dispatch-runtime-cycle.js";
import { CentralDispatchSessionMonitor } from "./central-dispatch-session-monitor.js";

function createStore(): BrowserRuntimeSnapshotStore {
  return { load: async () => ({ sessions: [], tabs: [] }), save: async () => undefined };
}

describe("Central Dispatch runtime cycle", () => {
  it("does not scan when the authenticated Central Dispatch page is unavailable", async () => {
    const runtime = new BrowserRuntime();
    runtime.registerSession({ id: "central-local", provider: "central-dispatch" });
    const reservation = runtime.reserveSearchTab({ provider: "central-dispatch", sourceFilterHash: "source-hash" });
    runtime.markTabReady(reservation.tab.id);
    let scans = 0;
    const cycle = new CentralDispatchRuntimeCycle(
      new CentralDispatchSessionMonitor(runtime, {
        findCentralDispatchTarget: async () => { throw new Error("Central Dispatch tab unavailable"); },
        evaluateJson: async () => undefined
      }, "central-local", createStore()),
      new DurableBrowserRuntimeController(runtime, createStore()),
      new BrowserScanCoordinator(runtime, new ScanScheduler(), {
        scan: async () => {
          scans += 1;
          return { searchId: "central-dispatch:source-hash", loads: [], isTruncated: false };
        }
      }, { process: async () => ({ scan: { newLoads: [], seeded: true, boundaryFound: false, overflowRisk: false } }) }
      )
    );

    const result = await cycle.processDue(1);

    assert.equal(result.health.status, "offline");
    assert.deepEqual(result.outcomes, []);
    assert.equal(scans, 0);
  });

  it("runs due scans after a healthy browser heartbeat", async () => {
    const now = new Date("2026-09-24T12:00:00.000Z");
    const runtime = new BrowserRuntime({ now: () => now });
    runtime.registerSession({ id: "central-local", provider: "central-dispatch" });
    const reservation = runtime.reserveSearchTab({ provider: "central-dispatch", sourceFilterHash: "source-hash" });
    runtime.markTabReady(reservation.tab.id);
    const cycle = new CentralDispatchRuntimeCycle(
      new CentralDispatchSessionMonitor(runtime, {
        findCentralDispatchTarget: async () => ({
          id: "central-tab",
          type: "page",
          url: "https://app.centraldispatch.com/search",
          webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/central-tab"
        }),
        evaluateJson: async () => undefined
      }, "central-local", createStore()),
      new DurableBrowserRuntimeController(runtime, createStore()),
      new BrowserScanCoordinator(runtime, new ScanScheduler(), {
        scan: async () => ({ searchId: "central-dispatch:source-hash", loads: [], isTruncated: false })
      }, { process: async () => ({ scan: { newLoads: [], seeded: true, boundaryFound: false, overflowRisk: false } }) }
      )
    );

    const result = await cycle.processDue(1, now);

    assert.equal(result.health.status, "healthy");
    assert.deepEqual(result.outcomes.map(({ status }) => status), ["processed"]);
  });
});
