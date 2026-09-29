# Release evidence record

Copy this template into the access-controlled operations system for each beta
expansion or production release. It is a record of evidence, not a deployment
instruction and not an approval by itself. Keep database URLs, tokens, browser
cookies, signed Telegram data, encryption keys, and customer-private details
out of this record.

## Release identity

| Field | Recorded value |
| --- | --- |
| UTC decision time | _not yet recorded_ |
| Environment | _not yet recorded_ |
| Intended Git revision | _not yet recorded_ |
| Successful Verify run URL | _not yet recorded_ |
| Prior known-good revision | _not yet recorded_ |
| Change summary | _not yet recorded_ |

## Ownership and decision authority

| Responsibility | Named person or rotation |
| --- | --- |
| Release owner | _not yet assigned_ |
| On-call owner | _not yet assigned_ |
| Rollback decision maker | _not yet assigned_ |
| Customer communication owner | _not yet assigned_ |

No expansion may proceed while a required ownership field remains unassigned.

## Validation evidence

| Gate | Evidence, UTC timestamp, and result |
| --- | --- |
| Repository `pnpm check` | _not yet recorded_ |
| API `/healthz` from production path | _not yet recorded_ |
| API `/readyz` from production path | _not yet recorded_ |
| Bot `/healthz` from production path | _not yet recorded_ |
| Credential-free `pnpm ops:probes` result | _not yet recorded_ |
| Admin dashboard operational signals | _not yet recorded_ |
| Central Dispatch local session readiness | _not yet recorded_ |
| End-to-end controlled alert delivery | _not yet recorded_ |
| Capacity exercise | _not yet recorded_ |
| Isolated restore rehearsal | _not yet recorded_ |

Record outcomes and links or identifiers only. Do not paste probe headers,
browser debugging addresses, signed requests, or database connection strings.

## Data recovery and monitoring

| Requirement | Evidence, UTC timestamp, and result |
| --- | --- |
| Backup schedule and immutable retention policy | _not yet recorded_ |
| RPO and RTO approved | _not yet recorded_ |
| Recovery owner confirmed | _not yet recorded_ |
| Current archive object identifier and checksum comparison | _not yet recorded_ |
| API, Bot, provider, and dead-letter monitoring configured | _not yet recorded_ |
| Alert routing tested with the on-call owner | _not yet recorded_ |

Use the [backup and restore procedure](postgres-backup-restore.md) for archive
validation and the [production runbook](production-runbook.md) for alert
thresholds and incident response.

## Customer safety and release decision

| Field | Recorded value |
| --- | --- |
| Beta cohort scope | _not yet defined_ |
| Support contact path | _not yet defined_ |
| Monitoring review interval | _not yet agreed_ |
| Notification latency target | _not yet agreed_ |
| Acceptable delivery failure rate | _not yet agreed_ |
| Rollback trigger | _not yet agreed_ |
| Rollback decision and UTC time | _not yet recorded_ |

The release owner should explicitly choose one outcome after reviewing the
evidence: **hold**, **controlled beta**, **expand beta**, or **rollback**.
Document the reason and any follow-up owner before closing the record.
