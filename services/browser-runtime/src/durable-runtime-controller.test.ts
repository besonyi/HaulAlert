import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BrowserRuntime } from "@haulalert/browser-runtime-core";

import { BrowserRuntimeOrchestrator, DurableBrowserRuntimeController, type BrowserRuntimeSnapshotStore } from "./index.js";

describe("durable browser runtime controller", () => {
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
