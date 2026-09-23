import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BrowserRuntime } from "@haulalert/browser-runtime-core";
import type { CompiledProviderFilter } from "@haulalert/filter-compiler";

import { BrowserRuntimeOrchestrator, type ProviderSearchDriver } from "./index.js";

const compiledFilter: CompiledProviderFilter = {
  provider: "central-dispatch",
  sourceFilter: { trailerTypes: ["open"] },
  internalFilter: { blockedBrokerIds: [] },
  sourceFilterHash: "source-hash"
};

function createRuntime(): BrowserRuntime {
  let tabNumber = 0;
  const runtime = new BrowserRuntime({ createTabId: () => `tab-${++tabNumber}` });
  runtime.registerSession({ id: "central-1", provider: "central-dispatch" });
  return runtime;
}

describe("browser runtime orchestrator", () => {
  it("configures a new search once and then reuses it", async () => {
    const calls: unknown[] = [];
    const driver: ProviderSearchDriver = {
      configureSearch: async (input) => {
        calls.push(input);
      }
    };
    const orchestrator = new BrowserRuntimeOrchestrator(createRuntime(), driver);

    const first = await orchestrator.activateSearch(compiledFilter);
    const second = await orchestrator.activateSearch(compiledFilter);

    assert.equal(first.reused, false);
    assert.equal(first.tab.status, "ready");
    assert.equal(second.reused, true);
    assert.equal(second.tab.id, first.tab.id);
    assert.equal(calls.length, 1);
  });

  it("closes a tab when provider search configuration fails", async () => {
    const runtime = createRuntime();
    const driver: ProviderSearchDriver = {
      configureSearch: async () => {
        throw new Error("Provider page did not load");
      }
    };
    const orchestrator = new BrowserRuntimeOrchestrator(runtime, driver);

    await assert.rejects(() => orchestrator.activateSearch(compiledFilter), /Provider page did not load/);
    assert.equal(runtime.listTabs()[0]?.status, "closed");
  });
});
