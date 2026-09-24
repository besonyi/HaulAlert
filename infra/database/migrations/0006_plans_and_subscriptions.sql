-- Product plans and customer subscription lifecycle. Prices and payment-provider
-- references intentionally live outside this core entitlement boundary.

CREATE TABLE plans (
  id TEXT PRIMARY KEY CHECK (char_length(trim(id)) > 0),
  name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
  max_active_alerts INTEGER NOT NULL CHECK (max_active_alerts > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO plans (id, name, max_active_alerts) VALUES ('starter', 'Starter', 3);

CREATE TABLE subscriptions (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL CHECK (status IN ('active', 'cancelled', 'expired')),
  current_period_ends_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX subscriptions_active_by_plan_idx ON subscriptions (plan_id, current_period_ends_at) WHERE status = 'active';

CREATE FUNCTION create_starter_subscription() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO subscriptions (user_id, plan_id, status) VALUES (NEW.id, 'starter', 'active');
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_create_starter_subscription
  AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION create_starter_subscription();

INSERT INTO subscriptions (user_id, plan_id, status)
SELECT id, 'starter', 'active' FROM users
ON CONFLICT (user_id) DO NOTHING;
