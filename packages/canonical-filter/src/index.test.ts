import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canonicalFilterSchema, parseCanonicalFilter } from "./index.js";

const route = {
  kind: "city" as const,
  city: "Sacramento",
  state: "CA",
  coordinates: { latitude: 38.5816, longitude: -121.4944 },
  radiusMiles: 100
};

describe("canonical filter", () => {
  it("parses a provider-neutral customer alert", () => {
    const filter = parseCanonicalFilter({
      schemaVersion: 1,
      name: "Driver Mike",
      origins: [route],
      destinations: [{ ...route, city: "Phoenix", state: "AZ" }],
      trailerTypes: ["open"],
      vehicles: { minimum: 1, maximum: 5 },
      readiness: { kind: "today" },
      minimumPayUsd: 1500,
      minimumRatePerMile: 1.8,
      providers: ["central-dispatch", "super-dispatch"],
      blockedBrokerIds: []
    });

    assert.equal(filter.name, "Driver Mike");
    assert.equal(filter.providers.length, 2);
  });

  it("rejects reversed vehicle limits", () => {
    const result = canonicalFilterSchema.safeParse({
      schemaVersion: 1,
      name: "Invalid limits",
      origins: [route],
      destinations: [route],
      trailerTypes: ["open"],
      vehicles: { minimum: 5, maximum: 1 },
      readiness: { kind: "any" },
      minimumPayUsd: null,
      minimumRatePerMile: null,
      providers: ["central-dispatch"]
    });

    assert.equal(result.success, false);
  });
});
