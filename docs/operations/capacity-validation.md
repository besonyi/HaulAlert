# Capacity validation

This procedure supplies evidence for Phase 9 capacity work. It does not define
customer-facing service-level objectives (SLOs): the release owner must agree
the monitoring interval, notification-latency target, delivery-failure budget,
and expected customer growth before a beta is expanded.

## 1. Run the local smoke workload

From the repository root, run:

```bash
pnpm load:test
```

The default workload creates 3,000 active alert subscriptions, evaluates 300
new loads, and schedules 2,000 browser tabs. It records candidate evaluation,
matches, and scheduling duration. It is deliberately bounded and has no
pass/fail threshold; it catches accidental algorithmic regressions before a
production-like exercise.

To test a proposed scale within the command's safety limits, set positive
integer overrides:

```bash
HAULALERT_LOAD_TEST_ALERTS=10000 \
HAULALERT_LOAD_TEST_LOADS=1000 \
HAULALERT_LOAD_TEST_TABS=5000 \
pnpm load:test
```

Record the commit SHA, machine/runtime details, workload, and JSON result. Do
not compare absolute milliseconds between different machines as an SLO.

## 2. Run a production-like exercise before beta expansion

Use an isolated PostgreSQL database with the intended migrations applied and a
Telegram test bot or transport sink. Never use production customer chat IDs,
provider credentials, or a production database for this exercise.

1. Start the API, browser-runtime worker, matcher/ingestion path, and durable
   notification worker with the isolated database.
2. Seed the agreed projected active-alert count and enough distinct users to
   represent the expected fan-out; retain the seed procedure and data volume in
   the evidence record.
3. Replay representative normalized `NEW_LOAD` events at the agreed peak and
   sustained rates. Include matching loads, non-matches, a high-fan-out load,
   duplicate provider IDs, and a temporary Telegram failure.
4. Measure end-to-end time from load discovery to terminal delivery state,
   database connection use and query latency, queue depth/age, dead-letter
   count, worker CPU/memory, and browser-tab scan duration.
5. Confirm idempotency: replaying a provider load does not create extra
   `notification_deliveries` or send a duplicate message.
6. Stop or fail one worker at a time and confirm retries, backoff, recovery,
   and operational signals follow the [production runbook](production-runbook.md).

The release owner decides whether measured results meet the agreed targets. A
capacity result without those targets is diagnostic evidence only and must not
be treated as launch approval.

## Evidence record

Attach the following to the beta/release decision:

- commit SHA, timestamp, operator, and runtime versions;
- expected and exercised alert/user/tab/event volumes and duration;
- local smoke JSON and production-like percentile/peak measurements;
- database and queue measurements, including any saturation or errors;
- delivery success, retry, dead-letter, and duplicate-delivery counts;
- the agreed targets, outcome, remediation items, and approving release owner.
