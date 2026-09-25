-- Stripe is the payment source of truth.  Keep provider event IDs so retries
-- are harmless, and only link an event to an account already known to HaulAlert.

ALTER TABLE subscriptions
  ADD COLUMN stripe_customer_id TEXT UNIQUE,
  ADD COLUMN stripe_subscription_id TEXT UNIQUE,
  ADD COLUMN latest_payment_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (latest_payment_status IN ('not_required', 'paid', 'failed', 'refunded', 'disputed'));

CREATE TABLE stripe_webhook_events (
  event_id TEXT PRIMARY KEY CHECK (char_length(trim(event_id)) > 0),
  event_type TEXT NOT NULL CHECK (char_length(trim(event_type)) > 0),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX stripe_webhook_events_by_user_idx ON stripe_webhook_events (user_id, received_at DESC);
