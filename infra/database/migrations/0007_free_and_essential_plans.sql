-- Referral Partner V1 plan model. Existing Starter accounts become Free.

ALTER TABLE plans
  ADD COLUMN monthly_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (monthly_price_cents >= 0),
  ADD COLUMN max_saved_alerts INTEGER NOT NULL DEFAULT 1 CHECK (max_saved_alerts > 0);

INSERT INTO plans (id, name, max_active_alerts, monthly_price_cents, max_saved_alerts)
VALUES
  ('free', 'Free', 1, 0, 1),
  ('essential', 'Essential', 10, 2500, 10)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  max_active_alerts = EXCLUDED.max_active_alerts,
  monthly_price_cents = EXCLUDED.monthly_price_cents,
  max_saved_alerts = EXCLUDED.max_saved_alerts;

UPDATE subscriptions SET plan_id = 'free' WHERE plan_id = 'starter';
DELETE FROM plans WHERE id = 'starter';

CREATE OR REPLACE FUNCTION create_starter_subscription() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO subscriptions (user_id, plan_id, status) VALUES (NEW.id, 'free', 'active');
  RETURN NEW;
END;
$$;
