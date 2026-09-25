import assert from "node:assert/strict";
import test from "node:test";

import { readinessLabel, vehicleCountLabel } from "./alert-filter-summary.js";

test("Mini App alert summary labels every readiness choice", () => {
  assert.equal(readinessLabel({ kind: "any" }), "Any ready date");
  assert.equal(readinessLabel({ kind: "today" }), "Ready today");
  assert.equal(readinessLabel({ kind: "tomorrow" }), "Ready tomorrow");
  assert.equal(readinessLabel({ kind: "date-range", availableFrom: "2026-10-01", availableUntil: "2026-10-04" }), "Ready 2026-10-01 to 2026-10-04");
});

test("Mini App alert summary labels vehicle-count bounds clearly", () => {
  assert.equal(vehicleCountLabel({ minimum: null, maximum: null }), "Any vehicle count");
  assert.equal(vehicleCountLabel({ minimum: 1, maximum: null }), "1+ vehicles");
  assert.equal(vehicleCountLabel({ minimum: null, maximum: 4 }), "Up to 4 vehicles");
  assert.equal(vehicleCountLabel({ minimum: 1, maximum: 1 }), "1 vehicle");
  assert.equal(vehicleCountLabel({ minimum: 2, maximum: 4 }), "2–4 vehicles");
});
