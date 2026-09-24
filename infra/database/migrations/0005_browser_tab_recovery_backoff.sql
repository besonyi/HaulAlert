-- Durable retry state for failed browser tab recovery. No provider session
-- material or error messages are stored here.

ALTER TABLE browser_search_tabs
  ADD COLUMN recovery_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (recovery_attempt_count >= 0),
  ADD COLUMN next_recovery_at TIMESTAMPTZ;

CREATE INDEX browser_search_tabs_recovery_idx
  ON browser_search_tabs (provider, next_recovery_at)
  WHERE status = 'degraded';
