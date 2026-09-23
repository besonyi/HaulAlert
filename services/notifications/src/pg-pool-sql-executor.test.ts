import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PgPoolSqlExecutor, getDatabaseUrl } from "./pg-pool-sql-executor.js";

describe("pg pool SQL executor", () => {
  it("passes SQL and values to pg as a parameterized query", async () => {
    let captured: { statement: string; parameters: readonly unknown[] } | undefined;
    const pool = {
      query: async (statement: string, parameters: readonly unknown[]) => {
        captured = { statement, parameters };
        return { rows: [{ id: "row-1" }] };
      }
    };
    const executor = new PgPoolSqlExecutor(pool);

    assert.deepEqual(await executor.query("SELECT id FROM loads WHERE id = $1", ["row-1"]), {
      rows: [{ id: "row-1" }]
    });
    assert.deepEqual(captured, {
      statement: "SELECT id FROM loads WHERE id = $1",
      parameters: ["row-1"]
    });
  });

  it("requires a PostgreSQL DATABASE_URL", () => {
    assert.throws(() => getDatabaseUrl({}), /DATABASE_URL/);
    assert.throws(() => getDatabaseUrl({ DATABASE_URL: "https://example.com" }), /postgres/);
    assert.equal(
      getDatabaseUrl({ DATABASE_URL: "postgresql://user:password@localhost:5432/haulalert" }),
      "postgresql://user:password@localhost:5432/haulalert"
    );
  });
});
