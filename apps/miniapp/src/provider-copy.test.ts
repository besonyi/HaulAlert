import assert from "node:assert/strict";
import test from "node:test";

import { providerListLabel, providerMonitoringSummary } from "./provider-copy.js";

test("Mini App uses customer-facing provider names", () => {
  assert.equal(providerListLabel(["central-dispatch", "shipcars"]), "Central Dispatch, Ship.Cars");
});

test("Mini App explains selected-board monitoring without session details", () => {
  assert.equal(
    providerMonitoringSummary(["super-dispatch"]),
    "HaulAlert monitors Super Dispatch and sends qualifying new loads to Telegram."
  );
  assert.equal(providerMonitoringSummary([]), "Choose at least one load board to start monitoring.");
});
