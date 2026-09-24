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
});
