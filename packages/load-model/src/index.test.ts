import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateRatePerMile, getGlobalLoadKey, normalizedLoadSchema } from "./index.js";

describe("normalized load model", () => {
  it("accepts a provider-neutral load record", () => {
    const load = normalizedLoadSchema.parse({
      provider: "central-dispatch",
      providerLoadId: "829181",
      pickup: { city: "Stockton", state: "CA", postalCode: null, coordinates: null },
      delivery: { city: "Phoenix", state: "AZ", postalCode: null, coordinates: null },
      vehicleCount: 3,
      trailerType: "open",
      payUsd: 2100,
      distanceMiles: 730,
      ratePerMile: 2.88,
      readyAt: "2026-09-22T00:00:00.000Z",
      postedAt: "2026-09-22T12:00:00.000Z",
      sourceUrl: null,
      broker: { name: "ABC Auto Transport", mcNumber: null, dotNumber: null }
    });

    assert.equal(getGlobalLoadKey(load), "central-dispatch:829181");
  });

  it("calculates rate per mile only when both values are known", () => {
    assert.equal(calculateRatePerMile(2100, 730), 2.88);
    assert.equal(calculateRatePerMile(null, 730), null);
    assert.equal(calculateRatePerMile(2100, null), null);
  });
});
