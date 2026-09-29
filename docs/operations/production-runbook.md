# Production operations runbook

This is the baseline response guide for HaulAlert's API, Telegram Bot,
notification worker, and Central Dispatch browser runtime. It intentionally
does not contain provider credentials, Telegram tokens, webhook secrets, or
browser session material.

## Service probes

| Service | Probe | Healthy response | Meaning |
| --- | --- | --- | --- |
| Mini App API | `GET /healthz` | `200 {"status":"ok"}` | HTTP process is running. |
| Mini App API | `GET /readyz` | `200 {"status":"ready"}` | HTTP process can query PostgreSQL. |
| Telegram Bot | `GET /healthz` on the Bot port | `200 {"status":"ok"}` | Webhook HTTP process is running; the probe does not invoke Telegram handling. |
| Central Dispatch runtime | local `GET /healthz` and `GET /readyz` | `200 {"status":"ok"}` and `200 {"status":"ready"}` | The worker is running and the local authenticated browser session is available for scans. |

Use the API readiness endpoint for a load balancer or deployment readiness
gate. Use liveness endpoints only to determine whether the process needs a
restart; a successful liveness response does not prove PostgreSQL is available.

For a release check or external monitor that needs to test all public probes
without logging response contents, set the two public base URLs in its secret
manager or monitor configuration and run:

```bash
HAULALERT_API_BASE_URL=https://api.example.test \
HAULALERT_BOT_BASE_URL=https://bot.example.test \
pnpm ops:probes
```

The command checks API liveness and readiness plus Bot liveness, uses a
five-second timeout by default, and prints only probe names, outcomes, and
durations. It accepts only credential-free HTTP(S) URLs.

When the command runs on the Central Dispatch runtime host, optionally set
`HAULALERT_CENTRAL_DISPATCH_HEALTH_BASE_URL=http://127.0.0.1:3010` to include
its local `/healthz` and `/readyz` checks. The command rejects any non-loopback
or credentialed Central Dispatch health URL.

The Central Dispatch worker also exposes loopback-only liveness and readiness
on `127.0.0.1:3010` by default (`CENTRAL_DISPATCH_HEALTH_PORT` changes only the
local port). A local monitoring agent may check those endpoints; do not expose
this port publicly or proxy it through the Mini App API.

## Alert thresholds

Configure the production monitoring system to alert the on-call owner when any
of the following persists beyond a transient retry window:

| Signal | Threshold | First response |
| --- | --- | --- |
| API readiness | two consecutive failed checks | Check database availability and the API logs; keep the process out of traffic until `/readyz` recovers. |
| Bot liveness | two failed checks or five minutes unavailable | Check the Bot process and the public route; do not rotate a webhook secret as an incident shortcut. |
| Central Dispatch session/tab state | offline or degraded for five minutes | Confirm Chrome is running locally and the manually authenticated Central Dispatch page is still open. |
| Central Dispatch circuit breaker | opens more than once per 15 minutes | Confirm the safe worker error signal and provider availability; leave the cooldown in place rather than forcing repeated calls. |
| Browser scan failures | repeated failure for the same provider search | Review the safe scan classification in the Admin dashboard, then validate the provider page manually. |
| Notification deliveries | any `dead_letter` row | Review the delivery attempt history and the affected customer before retrying or contacting them. |

The Admin dashboard is the primary product-level view for browser session,
tab, scan, delivery, and recovery state. It is protected by Telegram admin
allowlists; use a viewer account for investigation and an operator account only
for protected actions.

## Incident response

1. Record the UTC start time, affected service, symptoms, and the last known
   healthy probe result.
2. Identify scope with the relevant probe and Admin dashboard. Do not copy
   provider pages, cookies, signed Telegram `initData`, or secrets into an
   incident record.
3. For an API readiness failure, restore PostgreSQL connectivity first; then
   confirm `/readyz` before returning the API to traffic.
4. For a Bot outage, restore the HTTP process and public webhook route, then
   confirm Bot liveness. Telegram's retries and the webhook secret protect the
   request boundary; keep the existing secret unless a compromise is confirmed.
5. For a Central Dispatch outage, restore only the local, already-authenticated
   browser session. The worker marks unavailable sessions offline and resumes
   scans after a later healthy check; it must not persist browser credentials.
   For repeated worker-cycle failures, let the circuit breaker cool down before
   the next probe; do not restart it repeatedly to bypass provider protection.
6. For notification failures, the durable worker retries temporary failures
   with exponential backoff and respects Telegram rate limits. Inspect a
   dead-letter's attempt history rather than sending a manual duplicate.
7. Record the resolution, customer impact, and any follow-up test or alert
   threshold change.

## Recovery and rollback checks

Before a production release, confirm that all database migrations through
`0015_partner_commissions.sql` have been applied, then verify the API readiness and
Bot liveness probes. If a release causes a customer-impacting regression,
return to the last known-good application revision while preserving PostgreSQL
data. Database migrations are forward-only: do not roll back schema by deleting
records or applying ad-hoc destructive SQL during an incident.

Follow the [PostgreSQL backup and restore procedure](postgres-backup-restore.md)
for rehearsals and incident recovery. Backup scheduling, retention, and recovery
ownership must be configured by the production deployment owner before launch.
Use the [go-live checklist](go-live-checklist.md) to record the release evidence
and the remaining production-owner decisions before expanding a beta.
Use the access-controlled [release evidence template](release-evidence-template.md)
to keep the revision, ownership, validation, monitoring, and rollback decision
in one credential-free record.

After a restore or failover exercise, verify that durable delivery claims and
seen-load boundaries replay idempotently. The expected customer safety
properties are one notification per load/alert/customer key and no silent loss
of a new-load boundary after worker restart.
