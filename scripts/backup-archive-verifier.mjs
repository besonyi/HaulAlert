import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export const requiredBackupTables = [
  "users",
  "alerts",
  "provider_searches",
  "loads",
  "notification_deliveries",
  "notification_attempts",
  "search_seen_loads",
  "browser_sessions",
  "subscriptions",
  "referrals",
  "partner_accounts",
  "partner_commissions",
  "stripe_webhook_events",
  "admin_audit_events",
  "beta_feedback"
];

/** Finds durable HaulAlert tables absent from a pg_restore custom-archive listing. */
export function missingRequiredBackupTables(listing) {
  return requiredBackupTables.filter((table) => !hasTableListing(listing, table));
}

/** Calculates an archive checksum without retaining the archive contents in memory. */
export async function sha256File(filePath) {
  const checksum = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) checksum.update(chunk);
  return checksum.digest("hex");
}

/** Parses the credential-free arguments accepted by the local archive verifier. */
export function parseBackupVerificationArguments(argumentsList) {
  let includeChecksum = false;
  let expectedSha256;
  let archivePath;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--checksum") {
      if (includeChecksum) throw new Error("--checksum may be supplied only once");
      includeChecksum = true;
      continue;
    }
    if (argument === "--expected-sha256") {
      if (expectedSha256 !== undefined) throw new Error("--expected-sha256 may be supplied only once");
      expectedSha256 = normalizeSha256(argumentsList[index + 1]);
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) throw new Error(`Unknown backup verifier option: ${argument}`);
    if (archivePath !== undefined) throw new Error("Provide exactly one PostgreSQL custom-format backup archive");
    archivePath = argument;
  }

  if (archivePath === undefined) throw new Error("Provide exactly one PostgreSQL custom-format backup archive");
  return { archivePath, expectedSha256, includeChecksum };
}

function normalizeSha256(value) {
  if (typeof value !== "string" || !/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error("--expected-sha256 must be a 64-character hexadecimal SHA-256 checksum");
  }
  return value.toLowerCase();
}

function hasTableListing(listing, table) {
  return listing.includes(`TABLE public ${table}`)
    || listing.includes(`TABLE DATA public ${table}`);
}
