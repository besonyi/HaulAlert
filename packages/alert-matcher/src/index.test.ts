import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCanonicalFilter } from "@haulalert/canonical-filter";
import type { NormalizedLoad } from "@haulalert/load-model";

import { findMatchingAlerts, matchLoadToFilter } from "./index.js";

const filter = parseCanonicalFilter({
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
  providers: ["central-dispatch", "super-dispatch"],
  blockedBrokerIds: []
});

function load(overrides: Partial<NormalizedLoad> = {}): NormalizedLoad {
  return {
    provider: "central-dispatch",
    providerLoadId: "829181",
    pickup: {
      city: "Stockton",
      state: "CA",
      postalCode: null,
      coordinates: { latitude: 37.9577, longitude: -121.2908 }
    },
    delivery: {
      city: "Phoenix",
      state: "AZ",
      postalCode: null,
      coordinates: { latitude: 33.4484, longitude: -112.074 }
    },
    vehicleCount: 3,
    trailerType: "open",
    payUsd: 2100,
    distanceMiles: 730,
    ratePerMile: 2.88,
    readyAt: "2026-09-22T12:00:00.000Z",
    postedAt: "2026-09-22T12:00:00.000Z",
    sourceUrl: null,
    broker: { name: "ABC Auto Transport", mcNumber: "123456", dotNumber: null },
    ...overrides
  };
}

describe("alert matcher", () => {
  const now = new Date("2026-09-22T08:00:00.000Z");

  it("matches a load after all canonical conditions pass", () => {
    assert.deepEqual(matchLoadToFilter(load(), filter, now), { matches: true, failures: [] });
  });

  it("reports the exact conditions that keep a load from matching", () => {
    const result = matchLoadToFilter(
      load({ payUsd: 1400, ratePerMile: 1.5, vehicleCount: 7 }),
      filter,
      now
    );

    assert.equal(result.matches, false);
    assert.deepEqual(result.failures, ["vehicle-count", "minimum-pay", "minimum-rate"]);
  });

  it("blocks a broker by the stable MC identifier", () => {
    const blockedFilter = parseCanonicalFilter({ ...filter, blockedBrokerIds: ["mc:123456"] });

    assert.deepEqual(matchLoadToFilter(load(), blockedFilter, now).failures, ["blocked-broker"]);
  });

  it("fans a new load out only to matching alerts", () => {
    const matches = findMatchingAlerts(load(), [
      { alertId: "alert-a", userId: "user-a", filter },
      {
        alertId: "alert-b",
        userId: "user-b",
        filter: parseCanonicalFilter({ ...filter, minimumPayUsd: 3000 })
      }
    ], now);

    assert.deepEqual(matches.map((match) => match.alertId), ["alert-a"]);
  });
});
