# Go-live checklist

HaulAlert is ready for a controlled launch only when every applicable hard gate
below has evidence recorded by the production owner. This checklist describes
release criteria; it does not indicate that a production deployment or beta has
already been approved.

Record the applicable evidence in the access-controlled
[release evidence template](release-evidence-template.md). Do not copy
credentials, session data, or customer-private content into that record.

## Release evidence

- [ ] The intended commit has passed the repository `pnpm check` and a
  successful GitHub Actions Verify run.
- [ ] The release owner, on-call owner, and rollback decision maker are named.
- [ ] All PostgreSQL migrations through `0015_partner_commissions.sql` have been
  applied in lexical order, with the deployment result recorded.
- [ ] API `/healthz` and `/readyz`, plus Bot `/healthz`, return their expected
  responses from the production network path.
- [ ] The Admin Telegram viewer and operator allowlists are configured with
  real numeric IDs; legacy full-access allowlists are removed when no longer
  required.

## Data, secrets, and recovery

- [ ] `DATABASE_URL`, Telegram token, webhook secret, Stripe keys, and backup
  encryption/storage credentials are held only in the production secret manager.
- [ ] Local `.env`, generated session data, and browser profile material are
  excluded from the deployment artifact and Git history.
- [ ] The backup schedule, immutable retention period, RPO, RTO, and recovery
  owner are documented.
- [ ] An isolated restore rehearsal has completed following the
  [backup/restore procedure](postgres-backup-restore.md), including verification
  of delivery-key and seen-load-boundary safety.

## External integrations

- [ ] Telegram webhook is registered on the public HTTPS endpoint with the same
  configured secret and its Bot health endpoint is monitored.
- [ ] The Telegram Mini App URL is HTTPS, has no embedded credentials, and is
  launched successfully from a private `/start` message.
- [ ] Central Dispatch Chrome DevTools is bound only to loopback; an authorized
  operator has confirmed the manually authenticated page and a healthy runtime
  session before enabling customer alerts.
- [ ] Stripe remains disabled unless Checkout, Portal, and webhook settings are
  all configured; if billing is enabled, one test-mode purchase and webhook
  replay have been verified.

## Customer-safety gates

- [ ] A controlled beta cohort and its support contact path are defined.
- [ ] A test alert has been created, matched against a controlled load, and
  delivered once to the correct Telegram chat without a duplicate delivery.
- [ ] A capacity exercise has been recorded following the
  [capacity-validation procedure](capacity-validation.md), with results compared
  against the agreed customer-growth and latency targets.
- [ ] The Admin dashboard shows the expected browser session, scan, delivery,
  and recovery signals for the test path.
- [ ] Monitoring implements the thresholds in the
  [production runbook](production-runbook.md), including API readiness, Bot
  liveness, provider degradation, and dead-letter deliveries.
- [ ] A customer-facing monitoring interval, notification latency target, and
  acceptable delivery failure rate are explicitly agreed. These values are not
  defined by the repository and must be set before expanding the beta.

## Rollback decision

- [ ] The prior known-good application revision is identified and retrievable.
- [ ] The release owner has confirmed the forward-only migration constraint:
  application code may be rolled back, but production data and schema are not
  removed or downgraded ad hoc.
- [ ] The incident channel and customer communication owner are ready before
  traffic is expanded.

After every item is evidenced, launch with the agreed beta cohort, observe the
service for the agreed review interval, and only then decide whether to expand.
