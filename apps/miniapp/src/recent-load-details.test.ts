import assert from "node:assert/strict";
import test from "node:test";

import { brokerDetailsLabel, safeLoadBoardUrl } from "./recent-load-details.js";

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
