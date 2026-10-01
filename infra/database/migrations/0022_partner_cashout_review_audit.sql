-- Manual partner cash-out review is auditable. Approval records a decision
-- only; payout execution remains deliberately outside this application.

ALTER TABLE admin_audit_events
  DROP CONSTRAINT admin_audit_events_action_check;

ALTER TABLE admin_audit_events
  ADD CONSTRAINT admin_audit_events_action_check
  CHECK (action IN (
    'partner_approval_requested', 'partner_risk_updated',
    'partner_cashout_frozen', 'partner_cashout_unfrozen',
    'partner_cashout_approved', 'partner_cashout_rejected',
    'beta_feedback_reviewed'
  ));
