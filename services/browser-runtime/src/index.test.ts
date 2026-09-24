import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BrowserRuntime, ScanScheduler } from "@haulalert/browser-runtime-core";
import { createSourceFilterHash, type CompiledProviderFilter } from "@haulalert/filter-compiler";
import type { NormalizedLoad } from "@haulalert/load-model";

import {
  BrowserRuntimeOrchestrator,
  BrowserScanCoordinator,
  createCentralDispatchCdpSearchGateway,
  createHaulAlertSessionSearchGateway,
  NormalizingSessionProviderAdapter,
  SessionSearchGateway,
  UnknownProviderAdapterError,
  type ProviderSearchDriver,
  type ProviderSessionSearchClient,
  type ProviderSearchScanner,
  type HistoryAwareScanProcessor,
  type ScanHistoryRecorder,
  type ScanProcessor,
  type SessionBackedProviderAdapter
} from "./index.js";
import type { ChromeDevToolsTarget } from "./central-dispatch-cdp-executor.js";

const compiledFilter: CompiledProviderFilter = {
  provider: "central-dispatch",
  sourceFilter: { trailerTypes: ["open"] },
  internalFilter: { blockedBrokerIds: [] },
  sourceFilterHash: "source-hash"
};

function createRuntime(now: () => Date = () => new Date()): BrowserRuntime {
  let tabNumber = 0;
  const runtime = new BrowserRuntime({ now, createTabId: () => `tab-${++tabNumber}` });
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

  it("activates a persisted provider search without rebuilding its alert filter", async () => {
    const calls: unknown[] = [];
    const runtime = createRuntime();
    const orchestrator = new BrowserRuntimeOrchestrator(runtime, {
      configureSearch: async (input) => { calls.push(input); }
    });

    const activated = await orchestrator.activateProviderSearch({
      provider: "central-dispatch",
      sourceFilter: { trailerTypes: ["enclosed"] },
      sourceFilterHash: "persisted-hash"
    }, "11111111-1111-4111-8111-111111111111");

    assert.equal(activated.tab.providerSearchId, "11111111-1111-4111-8111-111111111111");
    assert.deepEqual(calls, [{
      sessionId: "central-1",
      tabId: activated.tab.id,
      provider: "central-dispatch",
      sourceFilter: { trailerTypes: ["enclosed"] }
    }]);
  });

  it("rehydrates a restored ready tab without allocating another tab", async () => {
    const calls: unknown[] = [];
    const runtime = createRuntime();
    const reservation = runtime.reserveSearchTab({ provider: "central-dispatch", sourceFilterHash: "persisted-hash" });
    const tab = runtime.markTabReady(reservation.tab.id);
    const orchestrator = new BrowserRuntimeOrchestrator(runtime, {
      configureSearch: async (input) => { calls.push(input); }
    });

    const configured = await orchestrator.reconfigureSearch(tab, {
      provider: "central-dispatch",
      sourceFilterHash: "persisted-hash",
      sourceFilter: { trailerTypes: ["open"] }
    });

    assert.equal(configured.id, tab.id);
    assert.deepEqual(runtime.listTabs().map(({ id, status }) => ({ id, status })), [{ id: tab.id, status: "ready" }]);
    assert.equal(calls.length, 1);
  });
});

describe("session search gateway", () => {
  it("routes configuration and scans only to the matching provider adapter", async () => {
    const calls: unknown[] = [];
    const adapter: SessionBackedProviderAdapter = {
      provider: "central-dispatch",
      configureSearch: async (input) => { calls.push(["configure", input]); },
      scan: async (input) => {
        calls.push(["scan", input]);
        return { searchId: "central-dispatch:source-hash", loads: [], isTruncated: false };
      }
    };
    const gateway = new SessionSearchGateway([adapter]);

    await gateway.configureSearch({
      sessionId: "session-1",
      tabId: "tab-1",
      provider: "central-dispatch",
      sourceFilter: { trailerTypes: ["open"] }
    });
    const result = await gateway.scan({
      sessionId: "session-1",
      tabId: "tab-1",
      provider: "central-dispatch",
      sourceFilterHash: "source-hash"
    });

    assert.deepEqual(calls, [
      ["configure", { sessionId: "session-1", tabId: "tab-1", sourceFilter: { trailerTypes: ["open"] } }],
      ["scan", { sessionId: "session-1", tabId: "tab-1", sourceFilterHash: "source-hash" }]
    ]);
    assert.equal(result.searchId, "central-dispatch:source-hash");
  });

  it("rejects a provider that has no configured session adapter", async () => {
    const gateway = new SessionSearchGateway([]);

    await assert.rejects(
      () => gateway.scan({
        sessionId: "session-1",
        tabId: "tab-1",
        provider: "shipcars",
        sourceFilterHash: "source-hash"
      }),
      UnknownProviderAdapterError
    );
  });
});

describe("normalizing session provider adapter", () => {
  it("turns an opaque provider page into an ordered scan without exposing session state", async () => {
    const configurations: unknown[] = [];
    const fetches: unknown[] = [];
    const client: ProviderSessionSearchClient = {
      configureSearch: async (input) => { configurations.push(input); },
      fetchSearch: async (input) => {
        fetches.push(input);
        return { payload: { listings: ["row-1"] }, isTruncated: true };
      }
    };
    const normalized: NormalizedLoad[] = [{
      provider: "central-dispatch",
      providerLoadId: "row-1",
      pickup: { city: null, state: null, postalCode: null, coordinates: null },
      delivery: { city: null, state: null, postalCode: null, coordinates: null },
      vehicleCount: 1,
      trailerType: "unknown",
      payUsd: null,
      distanceMiles: null,
      ratePerMile: null,
      readyAt: null,
      postedAt: null,
      sourceUrl: null,
      broker: null
    }];
    const adapter = new NormalizingSessionProviderAdapter(
      "central-dispatch",
      client,
      (payload) => payload === undefined ? [] : normalized
    );
    const input = { sessionId: "session-1", tabId: "tab-1", sourceFilterHash: "source-hash" };
    const configuration: Parameters<ProviderSessionSearchClient["configureSearch"]>[0] = {
      sessionId: "session-1",
      tabId: "tab-1",
      sourceFilter: { trailerTypes: ["open"] }
    };

    await adapter.configureSearch(configuration);
    const scan = await adapter.scan(input);

    assert.deepEqual(configurations, [configuration]);
    assert.deepEqual(fetches, [input]);
    assert.deepEqual(scan, {
      searchId: "central-dispatch:source-hash",
      loads: normalized,
      isTruncated: true
    });
  });
});

describe("HaulAlert session adapter composition", () => {
  it("registers every provider normalizer behind opaque session clients", async () => {
    const configurations: string[] = [];
    const client = (payload: unknown, isTruncated: boolean): ProviderSessionSearchClient => ({
      configureSearch: async () => { configurations.push("configured"); },
      fetchSearch: async () => ({ payload, isTruncated })
    });
    const gateway = createHaulAlertSessionSearchGateway({
      "central-dispatch": client({ items: [{ id: "central-1" }] }, false),
      "super-dispatch": client({ data: [{ load: { guid: "super-1" } }] }, true),
      shipcars: client({ results: [{ id: "shipcars-1" }] }, false)
    });
    const scanInput = (provider: CompiledProviderFilter["provider"]) => ({
      sessionId: "session-1",
      tabId: "tab-1",
      provider,
      sourceFilterHash: "source-hash"
    });

    await gateway.configureSearch({
      sessionId: "session-1",
      tabId: "tab-1",
      provider: "central-dispatch",
      sourceFilter: { trailerTypes: ["open"] }
    });
    const [central, superDispatch, shipCars] = await Promise.all([
      gateway.scan(scanInput("central-dispatch")),
      gateway.scan(scanInput("super-dispatch")),
      gateway.scan(scanInput("shipcars"))
    ]);

    assert.deepEqual(configurations, ["configured"]);
    assert.deepEqual(central.loads.map(({ provider, providerLoadId }) => [provider, providerLoadId]), [
      ["central-dispatch", "central-1"]
    ]);
    assert.deepEqual(superDispatch.loads.map(({ provider, providerLoadId }) => [provider, providerLoadId]), [
      ["super-dispatch", "super-1"]
    ]);
    assert.deepEqual(shipCars.loads.map(({ provider, providerLoadId }) => [provider, providerLoadId]), [
      ["shipcars", "shipcars-1"]
    ]);
    assert.equal(superDispatch.isTruncated, true);
  });
});

describe("Central Dispatch CDP gateway composition", () => {
  it("runs Central Dispatch without requiring placeholder clients for other providers", async () => {
    const target: ChromeDevToolsTarget = {
      id: "central-tab",
      type: "page",
      url: "https://app.centraldispatch.com/search",
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/central-tab"
    };
    const gateway = createCentralDispatchCdpSearchGateway({
      findCentralDispatchTarget: async () => target,
      evaluateJson: async () => ({ items: [{ id: "central-1" }], total: 1 })
    });
    const sourceFilter = { trailerTypes: ["open"] as ("open" | "enclosed")[] };
    const sourceFilterHash = createSourceFilterHash("central-dispatch", sourceFilter);

    await gateway.configureSearch({
      sessionId: "central-session",
      tabId: "central-tab",
      provider: "central-dispatch",
      sourceFilter
    });
    const scan = await gateway.scan({
      sessionId: "central-session",
      tabId: "central-tab",
      provider: "central-dispatch",
      sourceFilterHash
    });

    assert.deepEqual(scan, {
      searchId: `central-dispatch:${sourceFilterHash}`,
      loads: [{
        provider: "central-dispatch",
        providerLoadId: "central-1",
        pickup: { city: null, state: null, postalCode: null, coordinates: null },
        delivery: { city: null, state: null, postalCode: null, coordinates: null },
        vehicleCount: 1,
        trailerType: "unknown",
        payUsd: null,
        distanceMiles: null,
        ratePerMile: null,
        readyAt: null,
        postedAt: null,
        sourceUrl: "https://app.centraldispatch.com/search",
        broker: null
      }],
      isTruncated: false
    });
  });
});

describe("browser scan coordinator", () => {
  it("processes a due healthy tab and preserves its scan scheduling outcome", async () => {
    const scanAt = new Date("2026-09-23T12:00:00.000Z");
    const runtime = createRuntime(() => scanAt);
    const reservation = runtime.reserveSearchTab({ provider: "central-dispatch", sourceFilterHash: "source-hash" });
    runtime.markTabReady(reservation.tab.id);
    const scanner: ProviderSearchScanner = {
      scan: async () => ({ searchId: "central-dispatch:source-hash", loads: [], isTruncated: false })
    };
    const processor: ScanProcessor = {
      process: async () => ({ scan: { newLoads: [], seeded: true, boundaryFound: false, overflowRisk: false } })
    };
    const coordinator = new BrowserScanCoordinator(runtime, new ScanScheduler(), scanner, processor);

    const outcomes = await coordinator.processDue(1, scanAt);

    assert.deepEqual(outcomes.map(({ status }) => status), ["processed"]);
    assert.equal(outcomes[0]?.status === "processed" && outcomes[0].tab.lastScanAt, scanAt.toISOString());
  });

  it("degrades a tab when a provider returns rows with the wrong identity", async () => {
    const scanAt = new Date("2026-09-23T12:00:00.000Z");
    const runtime = createRuntime(() => scanAt);
    const reservation = runtime.reserveSearchTab({ provider: "central-dispatch", sourceFilterHash: "source-hash" });
    runtime.markTabReady(reservation.tab.id);
    const foreignLoad: NormalizedLoad = {
      provider: "shipcars",
      providerLoadId: "foreign-1",
      pickup: { city: null, state: null, postalCode: null, coordinates: null },
      delivery: { city: null, state: null, postalCode: null, coordinates: null },
      vehicleCount: 1,
      trailerType: "open",
      payUsd: null,
      distanceMiles: null,
      ratePerMile: null,
      readyAt: null,
      postedAt: null,
      sourceUrl: null,
      broker: null
    };
    const scanner: ProviderSearchScanner = {
      scan: async () => ({ searchId: "central-dispatch:source-hash", loads: [foreignLoad], isTruncated: false })
    };
    const processor: ScanProcessor = {
      process: async () => { throw new Error("should not process a foreign load"); }
    };
    const coordinator = new BrowserScanCoordinator(runtime, new ScanScheduler(), scanner, processor);

    const outcomes = await coordinator.processDue(1, scanAt);

    assert.equal(outcomes[0]?.status, "failed");
    assert.equal(runtime.listTabs()[0]?.status, "degraded");
  });

  it("records completed scans against their durable provider search", async () => {
    const scanAt = new Date("2026-09-23T12:00:00.000Z");
    const runtime = createRuntime(() => scanAt);
    const reservation = runtime.reserveSearchTab({
      provider: "central-dispatch",
      sourceFilterHash: "source-hash",
      providerSearchId: "11111111-1111-4111-8111-111111111111"
    });
    runtime.markTabReady(reservation.tab.id);
    const scanner: ProviderSearchScanner = {
      scan: async () => ({ searchId: "central-dispatch:source-hash", loads: [], isTruncated: false })
    };
    let completed: { providerSearchId: string; startedAt: Date; completedAt: Date } | undefined;
    const processor: ScanProcessor & { processCompletedScan: (scan: { providerSearchId: string; startedAt: Date; completedAt: Date }, history: ScanHistoryRecorder) => Promise<{ readonly scan: { readonly newLoads: readonly []; readonly seeded: boolean; readonly boundaryFound: boolean; readonly overflowRisk: boolean } }> } = {
      process: async () => ({ scan: { newLoads: [], seeded: true, boundaryFound: false, overflowRisk: false } }),
      processCompletedScan: async (scan, _history) => {
        completed = scan;
        return { scan: { newLoads: [], seeded: true, boundaryFound: false, overflowRisk: false } };
      }
    };
    const history: ScanHistoryRecorder = { record: async () => undefined };
    const coordinator = new BrowserScanCoordinator(runtime, new ScanScheduler(), scanner, processor, {
      history,
      clock: () => scanAt
    });

    await coordinator.processDue(1, scanAt);

    assert.deepEqual(completed, {
      providerSearchId: "11111111-1111-4111-8111-111111111111",
      scan: { searchId: "central-dispatch:source-hash", loads: [], isTruncated: false },
      startedAt: scanAt,
      completedAt: scanAt
    });
  });

  it("records a safe failure classification for a durable provider search", async () => {
    const scanAt = new Date("2026-09-23T12:00:00.000Z");
    const runtime = createRuntime(() => scanAt);
    const reservation = runtime.reserveSearchTab({
      provider: "central-dispatch",
      sourceFilterHash: "source-hash",
      providerSearchId: "11111111-1111-4111-8111-111111111111"
    });
    runtime.markTabReady(reservation.tab.id);
    let recorded: unknown;
    const history: ScanHistoryRecorder = {
      record: async () => undefined,
      recordFailure: async (input) => { recorded = input; }
    };
    const processor: ScanProcessor & { processCompletedScan: HistoryAwareScanProcessor["processCompletedScan"] } = {
      process: async () => ({ scan: { newLoads: [], seeded: true, boundaryFound: false, overflowRisk: false } }),
      processCompletedScan: async () => ({ scan: { newLoads: [], seeded: true, boundaryFound: false, overflowRisk: false } })
    };
    const coordinator = new BrowserScanCoordinator(runtime, new ScanScheduler(), {
      scan: async () => { throw new Error("Central Dispatch tab unexpectedly closed"); }
    }, processor, { history, clock: () => scanAt });

    const outcomes = await coordinator.processDue(1, scanAt);

    assert.equal(outcomes[0]?.status, "failed");
    assert.deepEqual(recorded, {
      providerSearchId: "11111111-1111-4111-8111-111111111111",
      startedAt: scanAt,
      completedAt: scanAt,
      errorCode: "scan_failed"
    });
  });
});
