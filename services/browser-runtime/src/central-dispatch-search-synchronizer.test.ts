import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ActivatedSearch, BrowserRuntimeOrchestrator, ProviderSearchActivation } from "./index.js";
import type { PersistentSearchTab } from "@haulalert/browser-runtime-core";
import { CentralDispatchSearchSynchronizer } from "./central-dispatch-search-synchronizer.js";
import type { DurableBrowserRuntimeController } from "./durable-runtime-controller.js";
import type { PostgresProviderSearchSource } from "./postgres-provider-search-source.js";

describe("Central Dispatch search synchronizer", () => {
  it("rehydrates restored searches once and retires tabs missing from the database", async () => {
    const calls: unknown[] = [];
    const tab: PersistentSearchTab = {
      id: "tab-1",
      providerSearchId: "11111111-1111-4111-8111-111111111111",
      sessionId: "central-local",
      provider: "central-dispatch",
      sourceFilterHash: "source-hash",
      status: "ready",
      createdAt: "2026-09-24T12:00:00.000Z",
      lastScanAt: null,
      recoveryAttemptCount: 0,
      nextRecoveryAt: null
    };
    const durableRuntime: Pick<DurableBrowserRuntimeController, "activateProviderSearch" | "reconfigureProviderSearch" | "closeInactiveProviderSearchTabs"> = {
      activateProviderSearch: async (
        _orchestrator: BrowserRuntimeOrchestrator,
        search: ProviderSearchActivation,
        id: string
      ): Promise<ActivatedSearch> => {
        calls.push(["activate", search, id]);
        return { tab, reused: true, recovered: false, recoveryDeferred: false };
      },
      reconfigureProviderSearch: async (
        _orchestrator: BrowserRuntimeOrchestrator,
        configuredTab: PersistentSearchTab,
        search: ProviderSearchActivation
      ): Promise<PersistentSearchTab> => {
        calls.push(["rehydrate", configuredTab.id, search.sourceFilterHash]);
        return configuredTab;
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
    await synchronizer.synchronize();

    assert.deepEqual(calls, [
      ["activate", {
        id: "11111111-1111-4111-8111-111111111111",
        provider: "central-dispatch",
        sourceFilterHash: "source-hash",
        sourceFilter: { trailerTypes: ["open"] }
      }, "11111111-1111-4111-8111-111111111111"],
      ["rehydrate", "tab-1", "source-hash"],
      ["close", "central-dispatch", ["11111111-1111-4111-8111-111111111111"]],
      ["activate", {
        id: "11111111-1111-4111-8111-111111111111",
        provider: "central-dispatch",
        sourceFilterHash: "source-hash",
        sourceFilter: { trailerTypes: ["open"] }
      }, "11111111-1111-4111-8111-111111111111"],
      ["close", "central-dispatch", ["11111111-1111-4111-8111-111111111111"]]
    ]);
  });

  it("does not reconfigure a tab while its durable recovery backoff is pending", async () => {
    const calls: string[] = [];
    const tab: PersistentSearchTab = {
      id: "tab-1",
      providerSearchId: "11111111-1111-4111-8111-111111111111",
      sessionId: "central-local",
      provider: "central-dispatch",
      sourceFilterHash: "source-hash",
      status: "degraded",
      createdAt: "2026-09-24T12:00:00.000Z",
      lastScanAt: null,
      recoveryAttemptCount: 1,
      nextRecoveryAt: "2026-09-24T12:00:30.000Z"
    };
    const durableRuntime: Pick<DurableBrowserRuntimeController, "activateProviderSearch" | "reconfigureProviderSearch" | "closeInactiveProviderSearchTabs"> = {
      activateProviderSearch: async (): Promise<ActivatedSearch> => {
        calls.push("activate");
        return { tab, reused: true, recovered: false, recoveryDeferred: true };
      },
      reconfigureProviderSearch: async () => {
        calls.push("reconfigure");
        return tab;
      },
      closeInactiveProviderSearchTabs: async () => {
        calls.push("close");
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

    assert.deepEqual(calls, ["activate", "close"]);
  });
});
