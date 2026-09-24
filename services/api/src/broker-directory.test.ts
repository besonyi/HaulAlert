import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBrokerQuery, PostgresBrokerDirectoryRepository } from "./broker-directory.js";

test("broker directory searches normalized broker profiles without exposing source session data", async () => {
  let captured: { statement: string; parameters: readonly unknown[] } | undefined;
  const repository = new PostgresBrokerDirectoryRepository({
    query: async (statement, parameters) => {
      captured = { statement, parameters };
      return { rows: [{ name: "Example Auto Transport", mc_number: "123456", dot_number: "654321", matched_load_count: "4" }] };
    }
  });
  assert.deepEqual(await repository.search(" 123 "), [{ name: "Example Auto Transport", mcNumber: "123456", dotNumber: "654321", matchedLoadCount: 4 }]);
  assert.deepEqual(captured?.parameters, ["123"]);
  assert.match(captured?.statement ?? "", /LIMIT 20/);
  assert.doesNotMatch(captured?.statement ?? "", /source_url/i);
});

test("broker directory rejects empty or oversized queries", () => {
  assert.throws(() => normalizeBrokerQuery("x"), /2 and 80/);
  assert.throws(() => normalizeBrokerQuery("x".repeat(81)), /2 and 80/);
});
