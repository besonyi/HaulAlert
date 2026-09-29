-- Extend the existing operator audit allowlist for the protected beta-feedback
-- review workflow. Keep the historical migration immutable for deployed DBs.

ALTER TABLE admin_audit_events
  DROP CONSTRAINT admin_audit_events_action_check;

ALTER TABLE admin_audit_events
  ADD CONSTRAINT admin_audit_events_action_check
  CHECK (action IN ('partner_approval_requested', 'beta_feedback_reviewed'));
