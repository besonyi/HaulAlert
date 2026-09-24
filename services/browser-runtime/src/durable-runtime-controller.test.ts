import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BrowserRuntime } from "@haulalert/browser-runtime-core";

import { BrowserRuntimeOrchestrator, DurableBrowserRuntimeController, type BrowserRuntimeSnapshotStore } from "./index.js";

describe("durable browser runtime controller", () => {
  it("restores durable metadata before the first scan cycle", async () => {
    const runtime = new BrowserRuntime();
    const store: BrowserRuntimeSnapshotStore = {
      load: async () => ({
        sessions: [{ id: "central-1", provider: "central-dispatch", status: "healthy", createdAt: "2026-09-24T12:00:00.000Z", lastHeartbeatAt: null }],
        tabs: [{ id: "tab-1", providerSearchId: null, sessionId: "central-1", provider: "central-dispatch", sourceFilterHash: "hash", status: "ready", createdAt: "2026-09-24T12:00:00.000Z", lastScanAt: null }]
      }),
      save: async () => undefined
    };

    await new DurableBrowserRuntimeController(runtime, store).restore();

    assert.deepEqual(runtime.listScannableTabs().map(({ id }) => id), ["tab-1"]);
  });

  it("persists runtime state after a new provider search is activated", async () => {
    const runtime = new BrowserRuntime({ createTabId: () => "tab-1" });
    runtime.registerSession({ id: "central-1", provider: "central-dispatch" });
    const saves: number[] = [];
    const store: BrowserRuntimeSnapshotStore = {
      load: async () => ({ sessions: [], tabs: [] }),
      save: async (snapshot) => { saves.push(snapshot.tabs.length); }
    };
    const controller = new DurableBrowserRuntimeController(runtime, store);
    const orchestrator = new BrowserRuntimeOrchestrator(runtime, { configureSearch: async () => undefined });

    await controller.activate(orchestrator, {
      provider: "central-dispatch",
      sourceFilter: { trailerTypes: ["open"] },
      internalFilter: { blockedBrokerIds: [] },
      sourceFilterHash: "hash"
    });

    assert.deepEqual(saves, [1]);
    assert.equal(runtime.listTabs()[0]?.status, "ready");
  });

  it("persists a closed tab when provider search configuration fails", async () => {
    const runtime = new BrowserRuntime({ createTabId: () => "tab-1" });
    runtime.registerSession({ id: "central-1", provider: "central-dispatch" });
    const statuses: string[] = [];
    const store: BrowserRuntimeSnapshotStore = {
      load: async () => ({ sessions: [], tabs: [] }),
      save: async (snapshot) => { statuses.push(snapshot.tabs[0]?.status ?? "missing"); }
    };
    const controller = new DurableBrowserRuntimeController(runtime, store);
    const orchestrator = new BrowserRuntimeOrchestrator(runtime, { configureSearch: async () => { throw new Error("navigation failed"); } });

    await assert.rejects(() => controller.activate(orchestrator, {
      provider: "central-dispatch", sourceFilter: {}, internalFilter: { blockedBrokerIds: [] }, sourceFilterHash: "hash"
    }), /navigation failed/);

    assert.deepEqual(statuses, ["closed"]);
  });

  it("closes only tabs whose durable provider search has become inactive", async () => {
    let tabNumber = 0;
    const runtime = new BrowserRuntime({ createTabId: () => `tab-${++tabNumber}` });
    runtime.registerSession({ id: "central-1", provider: "central-dispatch" });
    const retained = runtime.reserveSearchTab({
      provider: "central-dispatch", sourceFilterHash: "retained", providerSearchId: "11111111-1111-4111-8111-111111111111"
    });
    runtime.markTabReady(retained.tab.id);
    const retired = runtime.reserveSearchTab({
      provider: "central-dispatch", sourceFilterHash: "retired", providerSearchId: "22222222-2222-4222-8222-222222222222"
    });
    runtime.markTabReady(retired.tab.id);
    let saves = 0;
    const controller = new DurableBrowserRuntimeController(runtime, {
      load: async () => ({ sessions: [], tabs: [] }),
      save: async () => { saves += 1; }
    });

    const closed = await controller.closeInactiveProviderSearchTabs(
      "central-dispatch",
      new Set(["11111111-1111-4111-8111-111111111111"])
    );

    assert.deepEqual(closed.map((tab) => tab.id), [retired.tab.id]);
    assert.equal(runtime.listTabs().find((tab) => tab.id === retained.tab.id)?.status, "ready");
    assert.equal(runtime.listTabs().find((tab) => tab.id === retired.tab.id)?.status, "closed");
    assert.equal(saves, 1);
  });
});
