import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ActivatedSearch, BrowserRuntimeOrchestrator, ProviderSearchActivation } from "./index.js";
import type { PersistentSearchTab } from "@haulalert/browser-runtime-core";
import { CentralDispatchSearchSynchronizer } from "./central-dispatch-search-synchronizer.js";
import type { DurableBrowserRuntimeController } from "./durable-runtime-controller.js";
import type { PostgresProviderSearchSource } from "./postgres-provider-search-source.js";

describe("Central Dispatch search synchronizer", () => {
  it("activates every active search and retires tabs missing from the database", async () => {
    const calls: unknown[] = [];
    const durableRuntime: Pick<DurableBrowserRuntimeController, "activateProviderSearch" | "closeInactiveProviderSearchTabs"> = {
      activateProviderSearch: async (
        _orchestrator: BrowserRuntimeOrchestrator,
        search: ProviderSearchActivation,
        id: string
      ): Promise<ActivatedSearch> => {
        calls.push(["activate", search, id]);
        return { tab: {} as PersistentSearchTab, reused: false };
      },
      closeInactiveProviderSearchTabs: async (
        provider: PersistentSearchTab["provider"],
        ids: ReadonlySet<string>
      ): Promise<readonly PersistentSearchTab[]> => {
        calls.push(["close", provider, [...ids]]);
        return [];
      }
    };
    const synchronizer = new CentralDispatchSearchSynchronizer(
      {
        listActiveCentralDispatchSearches: async () => [{
          id: "11111111-1111-4111-8111-111111111111",
          provider: "central-dispatch",
          sourceFilterHash: "source-hash",
          sourceFilter: { trailerTypes: ["open"] }
        }]
      } as unknown as PostgresProviderSearchSource,
      durableRuntime as DurableBrowserRuntimeController,
      {} as BrowserRuntimeOrchestrator
    );

    await synchronizer.synchronize();

    assert.deepEqual(calls, [
      ["activate", {
        id: "11111111-1111-4111-8111-111111111111",
        provider: "central-dispatch",
        sourceFilterHash: "source-hash",
        sourceFilter: { trailerTypes: ["open"] }
      }, "11111111-1111-4111-8111-111111111111"],
      ["close", "central-dispatch", ["11111111-1111-4111-8111-111111111111"]]
    ]);
  });
});
