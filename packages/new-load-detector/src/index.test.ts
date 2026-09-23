import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { NormalizedLoad } from "@haulalert/load-model";

import { InMemorySeenLoadStore, NewLoadDetector } from "./index.js";

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
});
