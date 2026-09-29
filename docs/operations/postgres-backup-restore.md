# PostgreSQL backup and restore procedure

This procedure covers the HaulAlert PostgreSQL database. It is deliberately
credential-free: store `DATABASE_URL`, backup-encryption keys, and storage
credentials only in the deployment secret manager, never in this repository or
an incident ticket.

## What is protected

The backup must include all HaulAlert application data: users, alerts, provider
search definitions, normalized loads, scan history, notification deliveries and
attempts, subscriptions, referral/partner records, Stripe webhook events, and
the operator audit trail, and controlled-beta feedback. It does not include Telegram bot tokens, webhook
secrets, Stripe credentials, or Central Dispatch browser cookies; those are
external secret-manager or local-browser concerns.

## Backup baseline

1. Run `pg_dump` with custom format from a read-only or dedicated backup
   connection. Custom format supports integrity inspection and selective
   restore without embedding credentials in a command history.
2. Encrypt the generated backup before it leaves the controlled environment,
   then write it to access-controlled storage with immutable/versioned
   retention.
3. Record only the UTC completion time, PostgreSQL version, backup checksum,
   and storage object identifier in the operations log. Do not record the
   database URL or its password.
4. Alert when a scheduled backup is missing or its checksum cannot be verified.

The backup schedule, retention period, storage location, RPO, RTO, and named
owner are production policy decisions. They must be supplied by the deployment
owner before go-live; this repository does not claim that backups are already
scheduled.

## Restore rehearsal

Perform a restore rehearsal at least before a production launch and after a
material PostgreSQL upgrade. Always restore into an isolated, non-production
database:

1. Create a fresh target database and apply the same PostgreSQL extensions the
   application requires, including `pgcrypto`.
2. Verify the backup archive with `pg_restore --list` and the repository check
   below; compare its checksum to the operations record before restoring. The
   check reads only the archive manifest and never connects to a database or
   performs a restore:

   ```bash
   pnpm backup:verify -- /secure/path/haulalert.backup
   ```

   It confirms the archive contains every durable HaulAlert table required for
   a recovery rehearsal. To calculate a SHA-256 checksum for comparison with
   the operations log, add `--checksum`; this reads the full archive but keeps
   its contents out of process memory:

   ```bash
   pnpm backup:verify -- --checksum /secure/path/haulalert.backup
   ```

   When the operations log already contains the archive checksum, provide it to
   fail the verification if the archive differs. `--checksum` remains optional
   in this form because the verifier calculates it to compare the value:

   ```bash
   pnpm backup:verify -- --expected-sha256 <recorded-sha256> /secure/path/haulalert.backup
   ```
3. Restore into the empty target using a deployment-scoped database user. Do
   not use `--clean` or target the production database during a rehearsal.
4. Run the repository's migrations in lexical order through
   `0014_admin_audit_feedback_review.sql` only when the restored backup predates those
   schema changes.
5. Start API and worker processes against the isolated target, then verify API
   `/readyz`, Bot `/healthz`, and the Admin operational dashboard.
6. Check that historical notification deliveries retain their delivery keys and
   that provider seen-load boundaries are present. A worker restart must replay
   safely rather than create a duplicate notification or silently lose a new
   load boundary.
7. Capture actual restore duration, validation results, and any failures in the
   operations log. Use them to confirm or revise the RTO.

## Incident restore

An incident restore requires the designated production owner to select the
specific backup and approve the recovery target. Preserve the failed database
for forensic review when feasible. Restore application data forward from the
approved backup, apply forward-only migrations, verify `/readyz`, and then
bring workers back gradually while monitoring delivery retries and provider
session health. Never delete production records or attempt an ad-hoc schema
downgrade as a recovery shortcut.
