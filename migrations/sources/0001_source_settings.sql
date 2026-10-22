-- Independent of the existing playback/favourites database. Bind as SOURCE_DB.
CREATE TABLE IF NOT EXISTS moontv_source_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sources_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
