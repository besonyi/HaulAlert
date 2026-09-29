import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { tmpdir } from "node:os";

import {
  missingRequiredBackupTables,
  parseBackupVerificationArguments,
  requiredBackupTables,
  sha256File
} from "./backup-archive-verifier.mjs";

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

  it("calculates an archive checksum without keeping the file contents", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "haulalert-backup-verifier-"));
    const archivePath = join(temporaryDirectory, "archive.backup");
    try {
      await writeFile(archivePath, "haulalert backup verifier");
      assert.equal(
        await sha256File(archivePath),
        "b97065478543ca27f2e24ffc204f61bf8c6ca9ea37317e7e90d38749477ce652"
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("accepts a checksum expectation in either option order", () => {
    const checksum = "B97065478543CA27F2E24FFC204F61BF8C6CA9EA37317E7E90D38749477CE652";

    assert.deepEqual(
      parseBackupVerificationArguments(["--checksum", "--expected-sha256", checksum, "archive.backup"]),
      { archivePath: "archive.backup", expectedSha256: checksum.toLowerCase(), includeChecksum: true }
    );
    assert.deepEqual(
      parseBackupVerificationArguments(["--expected-sha256", checksum, "archive.backup"]),
      { archivePath: "archive.backup", expectedSha256: checksum.toLowerCase(), includeChecksum: false }
    );
  });

  it("rejects malformed or ambiguous verifier arguments", () => {
    assert.throws(
      () => parseBackupVerificationArguments(["--expected-sha256", "not-a-checksum", "archive.backup"]),
      /64-character hexadecimal/
    );
    assert.throws(
      () => parseBackupVerificationArguments(["first.backup", "second.backup"]),
      /exactly one/
    );
  });
});
