-- A request reserves the partner's selected gross cash-out amount in the
-- immutable ledger. It is not a provider payout and always starts in review.

CREATE TABLE partner_cashout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_account_id UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE RESTRICT,
  partner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  asset TEXT NOT NULL CHECK (asset IN ('usdt', 'usdc')),
  network TEXT NOT NULL CHECK (network ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  wallet_address TEXT NOT NULL CHECK (wallet_address ~ '^\S{12,160}$'),
  gross_amount_cents INTEGER NOT NULL CHECK (gross_amount_cents >= 5000),
  fixed_fee_cents INTEGER NOT NULL CHECK (fixed_fee_cents = 100),
  processing_fee_cents INTEGER NOT NULL CHECK (processing_fee_cents >= 0),
  total_fee_cents INTEGER NOT NULL CHECK (total_fee_cents = fixed_fee_cents + processing_fee_cents),
  net_amount_cents INTEGER NOT NULL CHECK (net_amount_cents = gross_amount_cents - total_fee_cents AND net_amount_cents > 0),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'reviewing', 'approved', 'processing', 'completed', 'rejected', 'cancelled', 'failed', 'frozen')),
  manual_review_required BOOLEAN NOT NULL DEFAULT true,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by_telegram_user_id TEXT,
  completed_at TIMESTAMPTZ,
  transaction_hash TEXT
);

CREATE UNIQUE INDEX partner_cashout_requests_one_open_per_account
  ON partner_cashout_requests (partner_account_id)
  WHERE status IN ('requested', 'reviewing', 'approved', 'processing');

CREATE INDEX partner_cashout_requests_by_partner_requested_idx
  ON partner_cashout_requests (partner_user_id, requested_at DESC, id DESC);

ALTER TABLE partner_ledger_entries
  ADD COLUMN cashout_request_id UUID REFERENCES partner_cashout_requests(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX partner_ledger_cashout_withdrawal_once
  ON partner_ledger_entries (cashout_request_id)
  WHERE entry_type = 'withdrawal';

CREATE UNIQUE INDEX partner_ledger_cashout_fee_once
  ON partner_ledger_entries (cashout_request_id)
  WHERE entry_type = 'cashout_fee';
