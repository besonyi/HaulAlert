-- Feedback review is an internal operator workflow. It never exposes or modifies
-- the customer's Telegram identity or message after the original submission.

ALTER TABLE beta_feedback
  ADD COLUMN reviewed_at TIMESTAMPTZ;

CREATE INDEX beta_feedback_open_by_created_idx
  ON beta_feedback (created_at DESC, id DESC)
  WHERE reviewed_at IS NULL;
