import { statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { missingRequiredBackupTables, requiredBackupTables } from "./backup-archive-verifier.mjs";

const [archiveArgument] = process.argv.slice(2);
if (archiveArgument === "--help" || archiveArgument === "-h") {
  console.log("Usage: pnpm backup:verify -- <custom-format-backup-file>");
  process.exit(0);
}
if (archiveArgument === undefined || process.argv.length !== 3) {
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
  requiredTableCount: requiredBackupTables.length
}, null, 2));
