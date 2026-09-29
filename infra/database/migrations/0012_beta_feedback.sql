-- Controlled beta feedback is scoped to the authenticated HaulAlert user.
-- Keep the body intentionally small; it is product feedback, not a support-data dump.

CREATE TABLE beta_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX beta_feedback_by_created_idx
  ON beta_feedback (created_at DESC, id DESC);
