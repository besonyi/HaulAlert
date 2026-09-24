import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCanonicalFilter } from "@haulalert/canonical-filter";

import {
  compileFilterForProvider,
  planCapacitySplit,
  type ProviderFilterCapabilities,
  ProviderNotEnabledError
} from "./index.js";

const centralCapabilities: ProviderFilterCapabilities = {
  provider: "central-dispatch",
  sourceFilterFields: ["origins", "destinations", "trailerTypes", "readiness", "minimumPayUsd", "minimumRatePerMile"],
  vehicleCountSupport: "range",
  newLoadDetectionStrategy: "tagged-top"
};

const superCapabilities: ProviderFilterCapabilities = {
  provider: "super-dispatch",
  sourceFilterFields: ["origins", "destinations"],
  vehicleCountSupport: "minimum-only",
  newLoadDetectionStrategy: "newest-first"
};

function createFilter(overrides: Record<string, unknown> = {}) {
  return parseCanonicalFilter({
    schemaVersion: 1,
    name: "Driver Mike",
    origins: [{
      kind: "city",
      city: "Sacramento",
      state: "CA",
      coordinates: { latitude: 38.5816, longitude: -121.4944 },
      radiusMiles: 100
    }],
    destinations: [{
      kind: "city",
      city: "Phoenix",
      state: "AZ",
      coordinates: { latitude: 33.4484, longitude: -112.074 },
      radiusMiles: 150
    }],
    trailerTypes: ["open"],
    vehicles: { minimum: 1, maximum: 5 },
    readiness: { kind: "today" },
    minimumPayUsd: 1500,
    minimumRatePerMile: 1.8,
    providers: ["central-dispatch"],
    blockedBrokerIds: ["broker-1"],
    ...overrides
  });
}

describe("filter compiler", () => {
  it("pushes supported fields to the provider and retains the rest internally", () => {
    const compiled = compileFilterForProvider(createFilter(), centralCapabilities);

    assert.deepEqual(Object.keys(compiled.sourceFilter).sort(), [
      "destinations",
      "minimumPayUsd",
      "minimumRatePerMile",
      "origins",
      "readiness",
      "trailerTypes",
      "vehicles"
    ]);
    assert.equal(compiled.internalFilter.vehicles, undefined);
    assert.equal(compiled.internalFilter.minimumPayUsd, undefined);
    assert.equal(compiled.internalFilter.minimumRatePerMile, undefined);
    assert.deepEqual(compiled.internalFilter.blockedBrokerIds, ["broker-1"]);
  });

  it("reuses a source hash when customer-only constraints differ", () => {
    const first = compileFilterForProvider(
      createFilter({ providers: ["super-dispatch"] }),
      superCapabilities
    );
    const second = compileFilterForProvider(
      createFilter({
        providers: ["super-dispatch"],
        name: "Driver Alex",
        minimumPayUsd: 1800,
        minimumRatePerMile: 2.2
      }),
      superCapabilities
    );

    assert.equal(first.sourceFilterHash, second.sourceFilterHash);
  });

  it("does not compile an unselected provider", () => {
    assert.throws(
      () => compileFilterForProvider(createFilter(), { ...centralCapabilities, provider: "super-dispatch" }),
      ProviderNotEnabledError
    );
  });

  it("keeps an unsupported vehicle maximum for exact internal matching", () => {
    const compiled = compileFilterForProvider(
      createFilter({ providers: ["super-dispatch"] }),
      superCapabilities
    );

    assert.deepEqual(compiled.sourceFilter.vehicles, { minimum: 1, maximum: null });
    assert.deepEqual(compiled.internalFilter.vehicles, { minimum: null, maximum: 5 });
    assert.equal(compiled.internalFilter.minimumPayUsd, 1500);
    assert.equal(compiled.internalFilter.minimumRatePerMile, 1.8);
  });

  it("partitions the wider provider-native route side without changing other constraints", () => {
    const compiled = compileFilterForProvider(createFilter({
      origins: [
        { kind: "state", state: "CA" },
        { kind: "state", state: "NV" }
      ]
    }), centralCapabilities);

    const plan = planCapacitySplit(compiled);

    assert.equal(plan.status, "split");
    assert.equal(plan.status === "split" && plan.dimension, "origins");
    assert.equal(plan.status === "split" && plan.buckets.length, 2);
    assert.deepEqual(plan.status === "split" && plan.buckets.map((bucket) => bucket.sourceFilter.origins), [
      [{ kind: "state", state: "CA" }],
      [{ kind: "state", state: "NV" }]
    ]);
    assert.deepEqual(plan.status === "split" && plan.buckets[0]?.sourceFilter.destinations, compiled.sourceFilter.destinations);
    assert.notEqual(plan.status === "split" && plan.buckets[0]?.sourceFilterHash, plan.status === "split" && plan.buckets[1]?.sourceFilterHash);
  });

  it("does not invent a route split when the provider search has one origin and destination", () => {
    const plan = planCapacitySplit(compileFilterForProvider(createFilter(), centralCapabilities));

    assert.deepEqual(plan, { status: "not-splittable", reason: "single-route-bucket", buckets: [] });
  });
});
