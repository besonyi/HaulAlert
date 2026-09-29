import { statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import {
  missingRequiredBackupTables,
  parseBackupVerificationArguments,
  requiredBackupTables,
  sha256File
} from "./backup-archive-verifier.mjs";

const argumentsList = process.argv.slice(2);
if (argumentsList.includes("--help") || argumentsList.includes("-h")) {
  console.log("Usage: pnpm backup:verify -- [--checksum] [--expected-sha256 <sha256>] <custom-format-backup-file>");
  process.exit(0);
}
const { archivePath: archiveArgument, expectedSha256, includeChecksum } = parseBackupVerificationArguments(argumentsList);

const archivePath = resolve(archiveArgument);
let archiveStats;
try {
  archiveStats = statSync(archivePath);
} catch {
  throw new Error("PostgreSQL backup archive could not be read");
}
if (!archiveStats.isFile()) {
  throw new Error("PostgreSQL backup archive must be a file");
}

const listing = spawnSync("pg_restore", ["--list", archivePath], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
  windowsHide: true
});
if (listing.error !== undefined || listing.status !== 0) {
  throw new Error("Could not inspect the backup archive with pg_restore --list");
}

const missingTables = missingRequiredBackupTables(listing.stdout);
if (missingTables.length > 0) {
  throw new Error(`Backup archive is missing required HaulAlert tables: ${missingTables.join(", ")}`);
}

const archiveSha256 = includeChecksum || expectedSha256 !== undefined
  ? await sha256File(archivePath)
  : undefined;
if (expectedSha256 !== undefined && archiveSha256 !== expectedSha256) {
  throw new Error("Backup archive checksum does not match the expected SHA-256 value");
}

console.log(JSON.stringify({
  status: "valid",
  requiredTableCount: requiredBackupTables.length,
  archiveSha256
}, null, 2));
