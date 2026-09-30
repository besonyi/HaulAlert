-- A hold is an auditable, reversible operator control. It is intentionally
-- separate from account-risk details and never exposes its internal reason to a partner.

CREATE TABLE partner_cashout_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_account_id UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  reason TEXT NOT NULL DEFAULT 'manual_review' CHECK (reason = 'manual_review'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX partner_cashout_holds_one_open_per_account
  ON partner_cashout_holds (partner_account_id)
  WHERE status = 'open';

CREATE INDEX partner_cashout_holds_open_by_account_idx
  ON partner_cashout_holds (partner_account_id, created_at DESC)
  WHERE status = 'open';

ALTER TABLE admin_audit_events
  DROP CONSTRAINT admin_audit_events_action_check;

ALTER TABLE admin_audit_events
  ADD CONSTRAINT admin_audit_events_action_check
  CHECK (action IN (
    'partner_approval_requested', 'partner_risk_updated',
    'partner_cashout_frozen', 'partner_cashout_unfrozen',
    'beta_feedback_reviewed'
  ));
