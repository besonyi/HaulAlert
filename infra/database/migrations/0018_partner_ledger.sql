-- Immutable financial entries are the source for a partner's available balance.
-- This schema deliberately has no wallet, payout-provider, or mutable-balance field.

CREATE TABLE partner_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_account_id UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE RESTRICT,
  partner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  partner_commission_id UUID REFERENCES partner_commissions(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'commission_available', 'refund_reversal', 'chargeback_clawback',
    'withdrawal', 'cashout_fee', 'manual_adjustment'
  )),
  amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
  currency TEXT NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX partner_ledger_commission_available_once
  ON partner_ledger_entries (partner_commission_id)
  WHERE entry_type = 'commission_available';

CREATE UNIQUE INDEX partner_ledger_commission_reversal_once
  ON partner_ledger_entries (partner_commission_id)
  WHERE entry_type IN ('refund_reversal', 'chargeback_clawback');

CREATE INDEX partner_ledger_entries_by_partner_created_idx
  ON partner_ledger_entries (partner_user_id, created_at DESC, id DESC);

-- Preserve the balance of commissions released before this migration.
INSERT INTO partner_ledger_entries (
  partner_account_id, partner_user_id, partner_commission_id, entry_type, amount_cents
)
SELECT partner_account_id, partner_user_id, id, 'commission_available', commission_amount_cents
FROM partner_commissions
WHERE status = 'available' AND commission_amount_cents <> 0
ON CONFLICT DO NOTHING;
