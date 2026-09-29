import { statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { missingRequiredBackupTables, requiredBackupTables, sha256File } from "./backup-archive-verifier.mjs";

const argumentsList = process.argv.slice(2);
if (argumentsList.includes("--help") || argumentsList.includes("-h")) {
  console.log("Usage: pnpm backup:verify -- [--checksum] <custom-format-backup-file>");
  process.exit(0);
}
const includeChecksum = argumentsList[0] === "--checksum";
const archiveArgument = includeChecksum ? argumentsList[1] : argumentsList[0];
if (archiveArgument === undefined || argumentsList.length !== (includeChecksum ? 2 : 1)) {
  throw new Error("Provide exactly one PostgreSQL custom-format backup archive");
}

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

console.log(JSON.stringify({
  status: "valid",
  requiredTableCount: requiredBackupTables.length,
  archiveSha256: includeChecksum ? await sha256File(archivePath) : undefined
}, null, 2));
