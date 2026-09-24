-- Referral Partner V1: durable referral codes and immutable first-touch attribution.

CREATE TABLE referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{8}$'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION generate_referral_code() RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  candidate TEXT;
BEGIN
  LOOP
    candidate := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    IF NOT EXISTS (SELECT 1 FROM referral_codes WHERE code = candidate) THEN
      RETURN candidate;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION create_user_referral_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO referral_codes (user_id, code) VALUES (NEW.id, generate_referral_code());
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_create_referral_code
  AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION create_user_referral_code();

INSERT INTO referral_codes (user_id, code)
SELECT users.id, generate_referral_code() FROM users
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  referred_user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  referral_code_id UUID NOT NULL REFERENCES referral_codes(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'active_paid', 'inactive', 'invalidated')),
  attributed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  invalidated_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (referrer_user_id <> referred_user_id)
);

CREATE INDEX referrals_by_referrer_status_idx ON referrals (referrer_user_id, status, created_at DESC);
CREATE INDEX referrals_active_paid_idx ON referrals (referrer_user_id, activated_at DESC) WHERE status = 'active_paid';
