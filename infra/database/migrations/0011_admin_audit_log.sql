-- Operator audit trail: records privileged customer-operation requests without storing secrets.

CREATE TABLE admin_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_telegram_user_id TEXT NOT NULL CHECK (actor_telegram_user_id ~ '^-?[0-9]+$'),
  action TEXT NOT NULL CHECK (action IN ('partner_approval_requested')),
  subject_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admin_audit_events_by_subject_idx
  ON admin_audit_events (subject_user_id, created_at DESC);

CREATE INDEX admin_audit_events_by_actor_idx
  ON admin_audit_events (actor_telegram_user_id, created_at DESC);
