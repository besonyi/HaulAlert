import assert from "node:assert/strict";
import test from "node:test";

import { readinessFromForm } from "./readiness-form.js";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
}

test("Mini App readiness form maps quick vehicle-ready choices", () => {
  assert.deepEqual(readinessFromForm(form({ readiness: "today" })), { kind: "today" });
  assert.deepEqual(readinessFromForm(form({ readiness: "tomorrow" })), { kind: "tomorrow" });
});

test("Mini App readiness form requires an ordered date range", () => {
  assert.deepEqual(readinessFromForm(form({ readiness: "date-range", availableFrom: "2026-10-01", availableUntil: "2026-10-04" })), {
    kind: "date-range", availableFrom: "2026-10-01", availableUntil: "2026-10-04"
  });
  assert.throws(() => readinessFromForm(form({ readiness: "date-range", availableFrom: "2026-10-04", availableUntil: "2026-10-01" })), /End date/);
});
