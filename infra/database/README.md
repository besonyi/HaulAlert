# PostgreSQL persistence

HaulAlert uses PostgreSQL for durable product state, ingestion telemetry, and notification delivery records. Credentials, provider browser sessions, and Telegram tokens do not belong in this schema.

Set `DATABASE_URL` in a local `.env` file, then apply migrations in lexical order:

```bash
psql "$DATABASE_URL" -f infra/database/migrations/0001_initial.sql
```

The application must use three transactional patterns:

1. Insert each provider load with `ON CONFLICT (provider, provider_load_id) DO NOTHING`; only an inserted row becomes a new-load event.
2. Insert each notification with `ON CONFLICT (delivery_key) DO NOTHING`; `delivery_key` is `provider:provider_load_id:alert_id:user_id`.
3. Workers claim ready deliveries in small batches with `FOR UPDATE SKIP LOCKED`, move them to `delivering`, and record every attempt. This prevents two workers from sending the same alert.

Failed deliveries move to `retry_scheduled` with `available_at` set to their next retry time. Exhausted jobs move to `dead_letter` and retain their error history in `notification_attempts`.
