-- HaulAlert's initial PostgreSQL schema.
-- Apply migrations in lexical order with a privileged deployment connection.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id BIGINT NOT NULL UNIQUE,
  telegram_chat_id BIGINT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'deleted')),
  canonical_filter JSONB NOT NULL CHECK (jsonb_typeof(canonical_filter) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX alerts_active_by_user_idx ON alerts (user_id, updated_at DESC) WHERE status = 'active';

CREATE TABLE provider_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('central-dispatch', 'super-dispatch', 'shipcars')),
  source_filter_hash TEXT NOT NULL CHECK (char_length(source_filter_hash) > 0),
  source_filter JSONB NOT NULL CHECK (jsonb_typeof(source_filter) = 'object'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, source_filter_hash)
);

CREATE TABLE alert_provider_searches (
  alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  provider_search_id UUID NOT NULL REFERENCES provider_searches(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (alert_id, provider_search_id)
);

CREATE INDEX alert_provider_searches_by_search_idx ON alert_provider_searches (provider_search_id, alert_id);

CREATE TABLE loads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('central-dispatch', 'super-dispatch', 'shipcars')),
  provider_load_id TEXT NOT NULL CHECK (char_length(trim(provider_load_id)) > 0),
  normalized_load JSONB NOT NULL CHECK (jsonb_typeof(normalized_load) = 'object'),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_load_id)
);

CREATE INDEX loads_first_seen_idx ON loads (first_seen_at DESC);

CREATE TABLE provider_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_search_id UUID NOT NULL REFERENCES provider_searches(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  result_count INTEGER NOT NULL CHECK (result_count >= 0),
  new_load_count INTEGER NOT NULL CHECK (new_load_count >= 0),
  boundary_found BOOLEAN NOT NULL,
  overflow_risk BOOLEAN NOT NULL,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (completed_at >= started_at)
);

CREATE INDEX provider_scans_by_search_idx ON provider_scans (provider_search_id, completed_at DESC);
CREATE INDEX provider_scans_overflow_risk_idx ON provider_scans (created_at DESC) WHERE overflow_risk;

CREATE TABLE notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_key TEXT NOT NULL UNIQUE CHECK (char_length(delivery_key) > 0),
  load_id UUID NOT NULL REFERENCES loads(id) ON DELETE RESTRICT,
  alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'delivering', 'retry_scheduled', 'sent', 'dead_letter', 'cancelled'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  telegram_message_id BIGINT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (sent_at IS NULL OR status = 'sent')
);

CREATE INDEX notification_deliveries_ready_idx
  ON notification_deliveries (available_at, created_at)
  WHERE status IN ('queued', 'retry_scheduled');
CREATE INDEX notification_deliveries_by_alert_idx ON notification_deliveries (alert_id, created_at DESC);
CREATE INDEX notification_deliveries_by_user_idx ON notification_deliveries (user_id, created_at DESC);

CREATE TABLE notification_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES notification_deliveries(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('sent', 'retry_scheduled', 'dead_letter', 'failed')),
  telegram_message_id BIGINT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, attempt_number)
);

CREATE INDEX notification_attempts_by_delivery_idx ON notification_attempts (delivery_id, attempt_number DESC);
