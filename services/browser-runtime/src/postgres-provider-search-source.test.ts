import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PostgresProviderSearchSource } from "./postgres-provider-search-source.js";

describe("PostgreSQL provider search source", () => {
  it("reads active Central Dispatch searches and parses their stored filter", async () => {
    const statements: string[] = [];
    const source = new PostgresProviderSearchSource({
      query: async (statement) => {
        statements.push(statement);
        return {
          rows: [{
            id: "11111111-1111-4111-8111-111111111111",
            provider: "central-dispatch",
            source_filter_hash: "source-hash",
            source_filter: JSON.stringify({ trailerTypes: ["open"] })
          }]
        };
      }
    });

    const searches = await source.listActiveCentralDispatchSearches();

    assert.deepEqual(searches, [{
      id: "11111111-1111-4111-8111-111111111111",
      provider: "central-dispatch",
      sourceFilterHash: "source-hash",
      sourceFilter: { trailerTypes: ["open"] }
    }]);
    assert.match(statements[0] ?? "", /searches\.provider = 'central-dispatch'/);
    assert.match(statements[0] ?? "", /alerts\.status = 'active'/);
  });

  it("rejects malformed durable source filters", async () => {
    const source = new PostgresProviderSearchSource({
      query: async () => ({
        rows: [{ id: "search-1", provider: "central-dispatch", source_filter_hash: "hash", source_filter: "[]" }]
      })
    });

    await assert.rejects(source.listActiveCentralDispatchSearches(), /Invalid Central Dispatch source_filter/);
  });
});
