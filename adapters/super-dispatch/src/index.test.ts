import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeSuperDispatchSearchResponse } from "./index.js";

describe("Super Dispatch response normalizer", () => {
  it("maps a session-search entry and converts meters to miles", () => {
    const loads = normalizeSuperDispatchSearchResponse({
      data: [{ load: {
        guid: "load-guid-1",
        pickup: { venue: { city: "Dallas", state: "tx", zip: "75201" }, scheduled_at: "2026-09-23T12:00:00Z" },
        delivery: { venue: { city: "Miami", state: "FL", zip: "33101" } },
        vehicles: [{ requires_enclosed_trailer: true }, {}],
        price: 1800,
        distance_meters: 1_609_344,
        posted_to_loadboard_at: "2026-09-23T11:00:00Z",
        shipper: { name: "Carrier Broker" }
      } }]
    });

    assert.deepEqual(loads[0], {
      provider: "super-dispatch",
      providerLoadId: "load-guid-1",
      pickup: { city: "Dallas", state: "TX", postalCode: "75201", coordinates: null },
      delivery: { city: "Miami", state: "FL", postalCode: "33101", coordinates: null },
      vehicleCount: 2,
      trailerType: "enclosed",
      payUsd: 1800,
      distanceMiles: 1000,
      ratePerMile: 1.8,
      readyAt: "2026-09-23T12:00:00.000Z",
      postedAt: "2026-09-23T11:00:00.000Z",
      sourceUrl: "https://carrier.superdispatch.com/loadboard/loads",
      broker: { name: "Carrier Broker", mcNumber: null, dotNumber: null }
    });
  });
});
