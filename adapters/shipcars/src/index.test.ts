import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildShipCarsSearchUrl,
  InvalidShipCarsSearchEndpointError,
  normalizeShipCarsSearchResponse,
  ShipCarsLiveLocationSelectionRequiredError
} from "./index.js";

describe("Ship.Cars response normalizer", () => {
  it("maps a session-search posting into the normalized provider-neutral load", () => {
    const loads = normalizeShipCarsSearchResponse({
      results: [{
        id: "sc-42",
        pickup_city: "Dallas",
        pickup_state: "tx",
        pickup_zip: "75201",
        pickup_address_location: { lat: 32.7767, lon: -96.797 },
        delivery_city: "Miami",
        delivery_state: "FL",
        delivery_zip: "33101",
        delivery_address_location: { lat: 25.7617, lon: -80.1918 },
        pickup_requested_date_start: "2026-09-24T12:00:00Z",
        vehicles: [{ year: 2023, make: "Ford", model: "F-150" }],
        enclosed_trailer: true,
        total_payment_to_carrier: 1800,
        distance_imperial: 1320,
        create_time: "2026-09-23T11:00:00Z"
      }]
    });

    assert.deepEqual(loads, [{
      provider: "shipcars",
      providerLoadId: "sc-42",
      pickup: {
        city: "Dallas",
        state: "TX",
        postalCode: "75201",
        coordinates: { latitude: 32.7767, longitude: -96.797 }
      },
      delivery: {
        city: "Miami",
        state: "FL",
        postalCode: "33101",
        coordinates: { latitude: 25.7617, longitude: -80.1918 }
      },
      vehicleCount: 1,
      trailerType: "enclosed",
      payUsd: 1800,
      distanceMiles: 1320,
      ratePerMile: 1.36,
      readyAt: "2026-09-24T12:00:00.000Z",
      postedAt: "2026-09-23T11:00:00.000Z",
      sourceUrl: "https://ship.cars/app/loadboard/postings",
      broker: null
    }]);
  });

  it("uses the provider fallback ID and filters malformed rows without losing valid postings", () => {
    const loads = normalizeShipCarsSearchResponse({
      results: [
        { id: " ", shipper_load_id: 77, first_available_date: "not-a-date", enclosed_trailer: false },
        { pickup_city: "Missing ID" },
        null
      ]
    });

    assert.equal(loads.length, 1);
    assert.deepEqual(loads[0], {
      provider: "shipcars",
      providerLoadId: "77",
      pickup: { city: null, state: null, postalCode: null, coordinates: null },
      delivery: { city: null, state: null, postalCode: null, coordinates: null },
      vehicleCount: 1,
      trailerType: "open",
      payUsd: null,
      distanceMiles: null,
      ratePerMile: null,
      readyAt: null,
      postedAt: null,
      sourceUrl: "https://ship.cars/app/loadboard/postings",
      broker: null
    });
  });
});

describe("Ship.Cars captured search builder", () => {
  it("reuses a matching opaque range while replacing only known search parameters", () => {
    const url = new URL(buildShipCarsSearchUrl(
      "https://ship.cars/api/cube/loadboard/v3/platform-web/postings?pickup_city=Dallas%2C%20TX&pickup_range=opaque-token%7C100&obsolete=discard&opaque=keep&limit=50",
      {
        origins: [{
          kind: "city",
          city: "Dallas",
          state: "TX",
          coordinates: { latitude: 32.7767, longitude: -96.797 },
          radiusMiles: 150
        }],
        destinations: [{ kind: "state", state: "FL" }],
        trailerTypes: ["enclosed"],
        vehicles: { minimum: 2, maximum: 4 },
        minimumPayUsd: 1200,
        minimumRatePerMile: 1.5
      }
    ));

    assert.equal(url.searchParams.get("opaque"), "keep");
    assert.equal(url.searchParams.get("obsolete"), "discard");
    assert.deepEqual(url.searchParams.getAll("pickup_city"), ["Dallas, TX"]);
    assert.deepEqual(url.searchParams.getAll("pickup_state"), ["TX"]);
    assert.deepEqual(url.searchParams.getAll("delivery_state"), ["FL"]);
    assert.equal(url.searchParams.get("pickup_range"), "opaque-token|150");
    assert.equal(url.searchParams.get("total_carrier_pay"), "1200");
    assert.equal(url.searchParams.get("price_per_mile"), "1.5");
    assert.equal(url.searchParams.get("number_vehicles"), "2");
    assert.equal(url.searchParams.get("max_number_vehicles"), "4");
    assert.equal(url.searchParams.get("enclosed_trailer"), "true");
    assert.equal(url.searchParams.get("limit"), "250");
    assert.equal(url.searchParams.get("offset"), "0");
    assert.equal(url.searchParams.get("ordering"), "-create_time");
  });

  it("does not synthesize a provider range or force a single trailer mode", () => {
    assert.throws(
      () => buildShipCarsSearchUrl(
        "https://ship.cars/api/cube/loadboard/v3/platform-web/postings?pickup_city=Dallas%2C%20TX&pickup_range=opaque-token%7C100",
        {
          origins: [{
            kind: "city",
            city: "Austin",
            state: "TX",
            coordinates: { latitude: 30.2672, longitude: -97.7431 },
            radiusMiles: 75
          }],
          trailerTypes: ["open", "enclosed"]
        }
      ),
      ShipCarsLiveLocationSelectionRequiredError
    );

    const url = new URL(buildShipCarsSearchUrl(
      "https://ship.cars/api/cube/loadboard/v3/platform-web/postings?opaque=keep",
      { trailerTypes: ["open", "enclosed"] }
    ));
    assert.equal(url.searchParams.has("enclosed_trailer"), false);
  });

  it("rejects a URL that is not the captured Ship.Cars postings endpoint", () => {
    assert.throws(
      () => buildShipCarsSearchUrl("https://example.com/postings", {}),
      InvalidShipCarsSearchEndpointError
    );
  });
});
