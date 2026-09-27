import assert from "node:assert/strict";
import test from "node:test";

import { brokerDetailsLabel, loadFacts, safeLoadBoardUrl } from "./recent-load-details.js";

test("Mini App accepts only safe external load-board URLs", () => {
  assert.equal(safeLoadBoardUrl("https://board.example/loads/42"), "https://board.example/loads/42");
  assert.equal(safeLoadBoardUrl("javascript:alert(1)"), undefined);
  assert.equal(safeLoadBoardUrl("ftp://board.example/loads/42"), undefined);
});

test("Mini App renders available broker identifiers", () => {
  assert.equal(brokerDetailsLabel({ name: "ABC Auto Transport", mcNumber: "123456", dotNumber: "654321" }), "ABC Auto Transport · MC 123456 · DOT 654321");
  assert.equal(brokerDetailsLabel({ name: "ABC Auto Transport", mcNumber: null, dotNumber: null }), "ABC Auto Transport");
  assert.equal(brokerDetailsLabel(null), undefined);
});

test("Mini App shows the useful facts from a recent load before it is opened", () => {
  assert.deepEqual(loadFacts({
    vehicleCount: 2,
    trailerType: "open",
    distanceMiles: 730,
    ratePerMile: 2.88,
    readyAt: "2026-09-28T10:00:00.000Z"
  }), ["2 vehicles", "Open trailer", "730 mi", "$2.88/mi", "Ready 2026-09-28"]);
  assert.deepEqual(loadFacts({
    vehicleCount: 1,
    trailerType: "unknown",
    distanceMiles: null,
    ratePerMile: null,
    readyAt: null
  }), ["1 vehicle", "Trailer not specified"]);
});
