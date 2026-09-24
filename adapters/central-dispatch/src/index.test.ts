import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeCentralDispatchListing,
  normalizeCentralDispatchSearchResponse
} from "./index.js";

describe("Central Dispatch response normalizer", () => {
  it("maps a session-search listing into the normalized provider-neutral load", () => {
    const load = normalizeCentralDispatchListing({
      id: 829181,
      origin: {
        city: "Stockton",
        state: "ca",
        zip: "95201",
        geoCode: { latitude: 37.9577, longitude: -121.2908 }
      },
      destination: { city: "Phoenix", state: "AZ", zip: "85001" },
      vehicles: [{ qty: 2 }, { qty: 1 }],
      trailerType: "OPEN",
      price: { total: 2100 },
      distance: 730,
      availableDate: "2026-09-23T12:00:00Z",
      createdDate: "2026-09-23T11:30:00Z",
      shipper: { companyName: "Example Auto Transport", mcNumber: "123456", dotNumber: "987654" }
    });

    assert.deepEqual(load, {
      provider: "central-dispatch",
      providerLoadId: "829181",
      pickup: {
        city: "Stockton",
        state: "CA",
        postalCode: "95201",
        coordinates: { latitude: 37.9577, longitude: -121.2908 }
      },
      delivery: { city: "Phoenix", state: "AZ", postalCode: "85001", coordinates: null },
      vehicleCount: 3,
      trailerType: "open",
      payUsd: 2100,
      distanceMiles: 730,
      ratePerMile: 2.88,
      readyAt: "2026-09-23T12:00:00.000Z",
      postedAt: "2026-09-23T11:30:00.000Z",
      sourceUrl: "https://app.centraldispatch.com/search",
      broker: { name: "Example Auto Transport", mcNumber: "123456", dotNumber: "987654" }
    });
  });

  it("drops malformed rows while retaining valid search results", () => {
    const loads = normalizeCentralDispatchSearchResponse({
      items: [
        { id: "valid", origin: {}, destination: {}, price: { total: -5 } },
        { origin: {}, destination: {} },
        null
      ]
    });

    assert.deepEqual(loads.map(({ providerLoadId, payUsd, vehicleCount }) => ({ providerLoadId, payUsd, vehicleCount })), [
      { providerLoadId: "valid", payUsd: null, vehicleCount: 1 }
    ]);
  });
});
