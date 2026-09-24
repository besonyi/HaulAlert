# PostgreSQL persistence

HaulAlert uses PostgreSQL for durable product state, ingestion telemetry, and notification delivery records. Credentials, provider browser sessions, and Telegram tokens do not belong in this schema.

Set `DATABASE_URL` in a local `.env` file, then apply migrations in lexical order:

```bash
psql "$DATABASE_URL" -f infra/database/migrations/0001_initial.sql
psql "$DATABASE_URL" -f infra/database/migrations/0002_notification_delivery_claim_lease.sql
psql "$DATABASE_URL" -f infra/database/migrations/0003_durable_search_detection_state.sql
psql "$DATABASE_URL" -f infra/database/migrations/0004_browser_runtime_metadata.sql
psql "$DATABASE_URL" -f infra/database/migrations/0005_browser_tab_recovery_backoff.sql
psql "$DATABASE_URL" -f infra/database/migrations/0006_plans_and_subscriptions.sql
psql "$DATABASE_URL" -f infra/database/migrations/0007_free_and_essential_plans.sql
```

The application must use three transactional patterns:

1. Insert each provider load with `ON CONFLICT (provider, provider_load_id) DO NOTHING`; only an inserted row becomes a new-load event.
2. Insert each notification with `ON CONFLICT (delivery_key) DO NOTHING`; `delivery_key` is `provider:provider_load_id:alert_id:user_id`.
3. Workers claim ready deliveries in small batches with `FOR UPDATE SKIP LOCKED`, move them to `delivering`, and record every attempt. This prevents two workers from sending the same alert.

Failed deliveries move to `retry_scheduled` with `available_at` set to their next retry time. Exhausted jobs move to `dead_letter` and retain their error history in `notification_attempts`.

Workers also lease claimed deliveries. On startup, a worker reclaims expired `delivering` leases, records a failed attempt, and either retries or dead-letters the job once its attempt limit is reached.

Search initialization and seen-load boundaries are durable. A collector only acknowledges newly observed rows after ingestion finishes, so a restart causes an idempotent replay instead of a silent missed alert.
