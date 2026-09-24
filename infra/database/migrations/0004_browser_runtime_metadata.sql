-- Browser runtime metadata only. Session credentials remain in the isolated
-- browser/session provider and must never be written to application storage.

CREATE TABLE browser_sessions (
  id TEXT PRIMARY KEY CHECK (char_length(trim(id)) > 0),
  provider TEXT NOT NULL CHECK (provider IN ('central-dispatch', 'super-dispatch', 'shipcars')),
  status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'expired', 'recovering', 'offline')),
  created_at TIMESTAMPTZ NOT NULL,
  last_heartbeat_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX browser_sessions_by_provider_status_idx ON browser_sessions (provider, status);

CREATE TABLE browser_search_tabs (
  id TEXT PRIMARY KEY CHECK (char_length(trim(id)) > 0),
  provider_search_id UUID REFERENCES provider_searches(id) ON DELETE SET NULL,
  session_id TEXT NOT NULL REFERENCES browser_sessions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('central-dispatch', 'super-dispatch', 'shipcars')),
  source_filter_hash TEXT NOT NULL CHECK (char_length(trim(source_filter_hash)) > 0),
  status TEXT NOT NULL CHECK (status IN ('provisioning', 'ready', 'degraded', 'closed')),
  created_at TIMESTAMPTZ NOT NULL,
  last_scan_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX browser_search_tabs_scannable_idx
  ON browser_search_tabs (provider, status, last_scan_at)
  WHERE status = 'ready';
