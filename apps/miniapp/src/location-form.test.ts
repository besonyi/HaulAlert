import assert from "node:assert/strict";
import test from "node:test";

import { locationFromForm } from "./location-form.js";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
}

test("Mini App location form keeps state routes simple", () => {
  assert.deepEqual(locationFromForm(form({ originKind: "state", originState: "ca" }), "origin"), {
    kind: "state",
    state: "CA"
  });
});

test("Mini App location form creates a bounded city radius", () => {
  assert.deepEqual(locationFromForm(form({
    destinationKind: "city",
    destinationCity: "Phoenix",
    destinationState: "az",
    destinationLatitude: "33.4484",
    destinationLongitude: "-112.0740",
    destinationRadius: "75"
  }), "destination"), {
    kind: "city",
    city: "Phoenix",
    state: "AZ",
    coordinates: { latitude: 33.4484, longitude: -112.074 },
    radiusMiles: 75
  });
});

test("Mini App location form rejects incomplete city radius data", () => {
  assert.throws(
    () => locationFromForm(form({ originKind: "city", originState: "CA", originCity: "Los Angeles" }), "origin"),
    /Origin latitude is required/ 
  );
});
