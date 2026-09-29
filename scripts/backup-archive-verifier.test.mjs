import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { missingRequiredBackupTables, requiredBackupTables } from "./backup-archive-verifier.mjs";

describe("backup archive verifier", () => {
  it("accepts a listing containing every durable HaulAlert table", () => {
    const listing = requiredBackupTables
      .map((table, index) => `${index}; 1259 1 TABLE public ${table} postgres`)
      .join("\n");

    assert.deepEqual(missingRequiredBackupTables(listing), []);
  });

  it("identifies a missing durable table", () => {
    const listing = requiredBackupTables
      .filter((table) => table !== "notification_deliveries")
      .map((table, index) => `${index}; 0 1 TABLE DATA public ${table} postgres`)
      .join("\n");

    assert.deepEqual(missingRequiredBackupTables(listing), ["notification_deliveries"]);
  });
});
