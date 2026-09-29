-- Record explicit operator risk decisions for partner accounts. The risk level
-- controls only the hold period of commissions created after the change.

ALTER TABLE admin_audit_events
  DROP CONSTRAINT admin_audit_events_action_check;

ALTER TABLE admin_audit_events
  ADD CONSTRAINT admin_audit_events_action_check
  CHECK (action IN ('partner_approval_requested', 'partner_risk_updated', 'beta_feedback_reviewed'));
