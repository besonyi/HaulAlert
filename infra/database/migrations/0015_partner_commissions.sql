-- Partner commissions are created only from verified paid Stripe invoices.
-- No wallet, withdrawal, or external payout capability is introduced here.

CREATE TABLE partner_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_account_id UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE RESTRICT,
  partner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  referral_id UUID NOT NULL REFERENCES referrals(id) ON DELETE RESTRICT,
  referred_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  stripe_invoice_id TEXT NOT NULL UNIQUE CHECK (stripe_invoice_id ~ '^in_'),
  gross_amount_cents INTEGER NOT NULL CHECK (gross_amount_cents > 0),
  commission_rate_basis_points INTEGER NOT NULL CHECK (commission_rate_basis_points >= 0 AND commission_rate_basis_points <= 10000),
  commission_amount_cents INTEGER NOT NULL CHECK (commission_amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'available', 'cancelled', 'reversed')),
  hold_until TIMESTAMPTZ NOT NULL,
  available_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (partner_user_id <> referred_user_id)
);

CREATE INDEX partner_commissions_by_partner_status_idx
  ON partner_commissions (partner_user_id, status, hold_until DESC);
