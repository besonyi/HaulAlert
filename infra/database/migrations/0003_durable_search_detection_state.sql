-- Persist the provider-result boundary so a browser-ingestion restart does not
-- silently seed the current window and lose alerts that appeared during downtime.

CREATE TABLE search_initializations (
  search_id TEXT PRIMARY KEY CHECK (char_length(trim(search_id)) > 0),
  initialized_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE search_seen_loads (
  -- Deliberately not a foreign key: the detector writes seed rows before it
  -- marks a search initialized, so an interrupted initial seed remains safe.
  search_id TEXT NOT NULL CHECK (char_length(trim(search_id)) > 0),
  load_key TEXT NOT NULL CHECK (char_length(trim(load_key)) > 0),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (search_id, load_key),
  UNIQUE (load_key)
);

CREATE INDEX search_seen_loads_recent_idx ON search_seen_loads (first_seen_at DESC);
