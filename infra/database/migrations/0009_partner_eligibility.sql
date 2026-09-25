-- Referral Partner V1: automatic eligibility and an explicit approval boundary.

CREATE TABLE partner_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('not_eligible', 'pending_approval', 'active', 'suspended', 'rejected', 'closed')),
  reward_mode TEXT NOT NULL DEFAULT 'referral_credit' CHECK (reward_mode IN ('referral_credit', 'partner_commission')),
  commission_rate_basis_points INTEGER NOT NULL DEFAULT 1500 CHECK (commission_rate_basis_points >= 0 AND commission_rate_basis_points <= 10000),
  risk_level TEXT NOT NULL DEFAULT 'new' CHECK (risk_level IN ('new', 'trusted', 'high_risk')),
  hold_days INTEGER NOT NULL DEFAULT 21 CHECK (hold_days >= 0 AND hold_days <= 365),
  partner_eligible_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  suspended_at TIMESTAMPTZ,
  trusted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION create_partner_account_when_eligible() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'active_paid' AND (
    SELECT count(*) FROM referrals
    WHERE referrer_user_id = NEW.referrer_user_id AND status = 'active_paid'
  ) >= 5 THEN
    INSERT INTO partner_accounts (user_id)
    VALUES (NEW.referrer_user_id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER referrals_create_partner_account
  AFTER INSERT OR UPDATE OF status ON referrals
  FOR EACH ROW EXECUTE FUNCTION create_partner_account_when_eligible();

INSERT INTO partner_accounts (user_id)
SELECT referrer_user_id
FROM referrals
WHERE status = 'active_paid'
GROUP BY referrer_user_id
HAVING count(*) >= 5
ON CONFLICT (user_id) DO NOTHING;
