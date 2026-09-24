import assert from "node:assert/strict";
import test from "node:test";

import { locationFromForm, locationsFromForm } from "./location-form.js";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
}

test("Mini App location form keeps state routes simple", () => {
  assert.deepEqual(locationFromForm(form({ originKind: "state", originState: "ca" }), "origin", "Origin"), {
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
  }), "destination", "Destination"), {
    kind: "city",
    city: "Phoenix",
    state: "AZ",
    coordinates: { latitude: 33.4484, longitude: -112.074 },
    radiusMiles: 75
  });
});

test("Mini App location form rejects incomplete city radius data", () => {
  assert.throws(
    () => locationFromForm(form({ originKind: "city", originState: "CA", originCity: "Los Angeles" }), "origin", "Origin"),
    /Origin latitude is required/ 
  );
});

test("Mini App location form retains every origin location group", () => {
  assert.deepEqual(locationsFromForm(form({
    originLocationPrefix: "origin1",
    origin1Kind: "state",
    origin1State: "CA"
  }), "origin"), [{ kind: "state", state: "CA" }]);

  const multiple = new FormData();
  multiple.append("originLocationPrefix", "origin1");
  multiple.append("originLocationPrefix", "origin2");
  multiple.set("origin1Kind", "state");
  multiple.set("origin1State", "CA");
  multiple.set("origin2Kind", "state");
  multiple.set("origin2State", "NV");
  assert.deepEqual(locationsFromForm(multiple, "origin"), [
    { kind: "state", state: "CA" },
    { kind: "state", state: "NV" }
  ]);
});
