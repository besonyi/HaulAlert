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
  "stripe_webhook_events",
  "admin_audit_events"
];

/** Finds durable HaulAlert tables absent from a pg_restore custom-archive listing. */
export function missingRequiredBackupTables(listing) {
  return requiredBackupTables.filter((table) => !hasTableListing(listing, table));
}

function hasTableListing(listing, table) {
  return listing.includes(`TABLE public ${table}`)
    || listing.includes(`TABLE DATA public ${table}`);
}
