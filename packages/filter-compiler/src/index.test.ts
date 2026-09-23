import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCanonicalFilter } from "@haulalert/canonical-filter";

import {
  compileFilterForProvider,
  type ProviderFilterCapabilities,
  ProviderNotEnabledError
} from "./index.js";

const centralCapabilities: ProviderFilterCapabilities = {
  provider: "central-dispatch",
  sourceFilterFields: ["origins", "destinations", "trailerTypes", "readiness"],
  newLoadDetectionStrategy: "tagged-top"
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
      "origins",
      "readiness",
      "trailerTypes"
    ]);
    assert.deepEqual(compiled.internalFilter.vehicles, { minimum: 1, maximum: 5 });
    assert.equal(compiled.internalFilter.minimumPayUsd, 1500);
    assert.equal(compiled.internalFilter.minimumRatePerMile, 1.8);
    assert.deepEqual(compiled.internalFilter.blockedBrokerIds, ["broker-1"]);
  });

  it("reuses a source hash when customer-only constraints differ", () => {
    const first = compileFilterForProvider(createFilter(), centralCapabilities);
    const second = compileFilterForProvider(
      createFilter({ name: "Driver Alex", minimumPayUsd: 1800, minimumRatePerMile: 2.2 }),
      centralCapabilities
    );

    assert.equal(first.sourceFilterHash, second.sourceFilterHash);
  });

  it("does not compile an unselected provider", () => {
    assert.throws(
      () => compileFilterForProvider(createFilter(), { ...centralCapabilities, provider: "super-dispatch" }),
      ProviderNotEnabledError
    );
  });
});
