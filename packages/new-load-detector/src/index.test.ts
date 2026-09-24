import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { NormalizedLoad } from "@haulalert/load-model";

import {
  AsyncNewLoadDetector,
  InMemorySeenLoadStore,
  NewLoadDetector,
  type AsyncSeenLoadStore
} from "./index.js";

class InMemoryAsyncSeenLoadStore implements AsyncSeenLoadStore {
  private readonly loadKeys = new Set<string>();
  private readonly initializedSearches = new Set<string>();

  public async has(_searchId: string, loadKey: string): Promise<boolean> {
    return this.loadKeys.has(loadKey);
  }

  public async add(_searchId: string, loadKey: string): Promise<void> {
    this.loadKeys.add(loadKey);
  }

  public async isSearchInitialized(searchId: string): Promise<boolean> {
    return this.initializedSearches.has(searchId);
  }

  public async markSearchInitialized(searchId: string): Promise<void> {
    this.initializedSearches.add(searchId);
  }
}

function load(providerLoadId: string): NormalizedLoad {
  return {
    provider: "central-dispatch",
    providerLoadId,
    pickup: { city: "Sacramento", state: "CA", postalCode: null, coordinates: null },
    delivery: { city: "Phoenix", state: "AZ", postalCode: null, coordinates: null },
    vehicleCount: 3,
    trailerType: "open",
    payUsd: 2100,
    distanceMiles: 730,
    ratePerMile: 2.88,
    readyAt: null,
    postedAt: null,
    sourceUrl: null,
    broker: null
  };
}

describe("new load detector", () => {
  it("seeds an initial search without notifying about pre-existing rows", () => {
    const detector = new NewLoadDetector(new InMemorySeenLoadStore());

    const result = detector.inspect({
      searchId: "central:source-hash",
      loads: [load("105"), load("104")],
      isTruncated: false
    });

    assert.equal(result.seeded, true);
    assert.deepEqual(result.newLoads, []);
  });

  it("emits only the unseen top delta up to the first known row", () => {
    const detector = new NewLoadDetector(new InMemorySeenLoadStore());
    detector.inspect({
      searchId: "central:source-hash",
      loads: [load("105"), load("104")],
      isTruncated: false
    });

    const result = detector.inspect({
      searchId: "central:source-hash",
      loads: [load("108"), load("107"), load("105"), load("104")],
      isTruncated: false
    });

    assert.equal(result.seeded, false);
    assert.equal(result.boundaryFound, true);
    assert.deepEqual(result.newLoads.map((item) => item.providerLoadId), ["108", "107"]);
  });

  it("deduplicates globally when overlapping source searches see the same load", () => {
    const detector = new NewLoadDetector(new InMemorySeenLoadStore());
    detector.inspect({
      searchId: "central:wide-route",
      loads: [load("105")],
      isTruncated: false
    });
    detector.inspect({
      searchId: "central:narrow-route",
      loads: [load("105")],
      isTruncated: false
    });

    const wideResult = detector.inspect({
      searchId: "central:wide-route",
      loads: [load("108"), load("105")],
      isTruncated: false
    });
    const narrowResult = detector.inspect({
      searchId: "central:narrow-route",
      loads: [load("108"), load("105")],
      isTruncated: false
    });

    assert.deepEqual(wideResult.newLoads.map((item) => item.providerLoadId), ["108"]);
    assert.deepEqual(narrowResult.newLoads, []);
  });

  it("flags a capped scan that no longer contains a known boundary", () => {
    const detector = new NewLoadDetector(new InMemorySeenLoadStore());
    detector.inspect({
      searchId: "central:source-hash",
      loads: [load("105")],
      isTruncated: false
    });

    const result = detector.inspect({
      searchId: "central:source-hash",
      loads: [load("400"), load("399")],
      isTruncated: true
    });

    assert.equal(result.boundaryFound, false);
    assert.equal(result.overflowRisk, true);
  });

  it("acknowledges new rows only after durable ingestion succeeds", async () => {
    const detector = new AsyncNewLoadDetector(new InMemoryAsyncSeenLoadStore());
    const initial = { searchId: "central:source-hash", loads: [load("105")], isTruncated: false };
    await detector.inspect(initial);

    const next = {
      searchId: "central:source-hash",
      loads: [load("108"), load("105")],
      isTruncated: false
    };
    const firstAttempt = await detector.inspect(next);
    const replayBeforeAcknowledgement = await detector.inspect(next);

    assert.deepEqual(firstAttempt.newLoads.map(({ providerLoadId }) => providerLoadId), ["108"]);
    assert.deepEqual(replayBeforeAcknowledgement.newLoads.map(({ providerLoadId }) => providerLoadId), ["108"]);

    await detector.acknowledge(next, firstAttempt);
    const afterAcknowledgement = await detector.inspect(next);
    assert.deepEqual(afterAcknowledgement.newLoads, []);
    assert.equal(afterAcknowledgement.boundaryFound, true);
  });

  it("keeps the durable seen boundary global across overlapping searches", async () => {
    const detector = new AsyncNewLoadDetector(new InMemoryAsyncSeenLoadStore());
    await detector.inspect({ searchId: "central:wide", loads: [load("105")], isTruncated: false });
    await detector.inspect({ searchId: "central:narrow", loads: [load("105")], isTruncated: false });

    const wide = { searchId: "central:wide", loads: [load("108"), load("105")], isTruncated: false };
    const narrow = { searchId: "central:narrow", loads: [load("108"), load("105")], isTruncated: false };
    const wideResult = await detector.inspect(wide);
    await detector.acknowledge(wide, wideResult);
    const narrowResult = await detector.inspect(narrow);

    assert.deepEqual(wideResult.newLoads.map(({ providerLoadId }) => providerLoadId), ["108"]);
    assert.deepEqual(narrowResult.newLoads, []);
  });
});
