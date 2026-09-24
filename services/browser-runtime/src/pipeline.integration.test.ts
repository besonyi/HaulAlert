import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BrowserRuntime, ScanScheduler } from "@haulalert/browser-runtime-core";
import { ScanIngestionProcessor, type LoadIngestion } from "@haulalert/ingestion-service";
import type { NormalizedLoad } from "@haulalert/load-model";
import { AsyncNewLoadDetector, InMemorySeenLoadStore, NewLoadDetector, type AsyncSeenLoadStore, type OrderedLoadScan } from "@haulalert/new-load-detector";

import { BrowserRuntimeOrchestrator, BrowserScanCoordinator, createHaulAlertSessionSearchGateway } from "./index.js";

describe("provider scan ingestion pipeline", () => {
  it("ingests only the new provider row after the initial session window is seeded", async () => {
    let now = new Date("2026-09-24T12:00:00.000Z");
    const runtime = new BrowserRuntime({ now: () => now, createTabId: () => "tab-1" });
    runtime.registerSession({ id: "central-1", provider: "central-dispatch" });
    let payload: unknown = { items: [{ id: "old" }] };
    const gateway = createHaulAlertSessionSearchGateway({
      "central-dispatch": { configureSearch: async () => undefined, fetchSearch: async () => ({ payload, isTruncated: false }) },
      "super-dispatch": { configureSearch: async () => undefined, fetchSearch: async () => ({ payload: { data: [] }, isTruncated: false }) },
      shipcars: { configureSearch: async () => undefined, fetchSearch: async () => ({ payload: { results: [] }, isTruncated: false }) }
    });
    const ingested: string[] = [];
    const ingestion: LoadIngestion = { ingest: async (load) => { ingested.push(load.providerLoadId); return { status: "known", load }; } };
    const processor = new ScanIngestionProcessor(new NewLoadDetector(new InMemorySeenLoadStore()), ingestion);
    const orchestrator = new BrowserRuntimeOrchestrator(runtime, gateway);
    await orchestrator.activateSearch({ provider: "central-dispatch", sourceFilter: {}, internalFilter: { blockedBrokerIds: [] }, sourceFilterHash: "hash" });
    const coordinator = new BrowserScanCoordinator(runtime, new ScanScheduler(), gateway, processor);

    await coordinator.processDue(1, now);
    payload = { items: [{ id: "new" }, { id: "old" }] };
    now = new Date("2026-09-24T12:01:00.000Z");
    await coordinator.processDue(1, now);

    assert.deepEqual(ingested, ["new"]);
  });

  it("acknowledges a durable provider delta after ingestion", async () => {
    const seen = new Set<string>();
    const initialized = new Set<string>();
    const store: AsyncSeenLoadStore = {
      has: async (_search, key) => seen.has(key),
      add: async (_search, key) => { seen.add(key); },
      isSearchInitialized: async (search) => initialized.has(search),
      markSearchInitialized: async (search) => { initialized.add(search); }
    };
    const detector = new AsyncNewLoadDetector(store);
    const old: NormalizedLoad = { provider: "central-dispatch", providerLoadId: "old", pickup: { city: null, state: null, postalCode: null, coordinates: null }, delivery: { city: null, state: null, postalCode: null, coordinates: null }, vehicleCount: 1, trailerType: "unknown", payUsd: null, distanceMiles: null, ratePerMile: null, readyAt: null, postedAt: null, sourceUrl: null, broker: null };
    const seed = { searchId: "central-dispatch:hash", loads: [old], isTruncated: false };
    await detector.inspect(seed);
    const next: OrderedLoadScan = { ...seed, loads: [{ ...old, providerLoadId: "new" }, old] };
    const detected = await detector.inspect(next);
    await detector.acknowledge(next, detected);
    assert.deepEqual((await detector.inspect(next)).newLoads, []);
  });
});
