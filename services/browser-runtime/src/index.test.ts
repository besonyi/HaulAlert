import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BrowserRuntime, ScanScheduler } from "@haulalert/browser-runtime-core";
import type { CompiledProviderFilter } from "@haulalert/filter-compiler";
import type { NormalizedLoad } from "@haulalert/load-model";

import {
  BrowserRuntimeOrchestrator,
  BrowserScanCoordinator,
  type ProviderSearchDriver,
  type ProviderSearchScanner,
  type ScanHistoryRecorder,
  type ScanProcessor
} from "./index.js";

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
});
