import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AlertMatch } from "@haulalert/alert-matcher";

import { renderNewLoadNotification } from "./index.js";

const match: AlertMatch = {
  alertId: "alert-1",
  userId: "telegram-1",
  load: {
    provider: "central-dispatch",
    providerLoadId: "829181",
    pickup: { city: "Stockton", state: "CA", postalCode: null, coordinates: null },
    delivery: { city: "Phoenix", state: "AZ", postalCode: null, coordinates: null },
    vehicleCount: 3,
    trailerType: "open",
    payUsd: 2100,
    distanceMiles: 730,
    ratePerMile: 2.88,
    readyAt: "2026-09-22T12:00:00.000Z",
    postedAt: "2026-09-22T12:00:00.000Z",
    sourceUrl: null,
    broker: { name: "ABC Auto Transport", mcNumber: null, dotNumber: null }
  }
};

describe("Telegram notification renderer", () => {
  it("renders the essential new-load details", () => {
    const notification = renderNewLoadNotification(match, {
      loadDetailsUrl: "https://app.haulalert.example/loads/central-dispatch:829181"
    });

    assert.match(notification.text, /Stockton, CA → Phoenix, AZ/);
    assert.match(notification.text, /\$2,100/);
    assert.match(notification.text, /\$2\.88\/mi/);
    assert.match(notification.text, /Central Dispatch/);
    assert.deepEqual(notification.actions, [{
      label: "OPEN LOAD",
      url: "https://app.haulalert.example/loads/central-dispatch:829181"
    }]);
  });
});
