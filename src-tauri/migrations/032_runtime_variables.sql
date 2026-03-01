-- Runtime variable definitions for custom per-entity variables
CREATE TABLE IF NOT EXISTS pack_runtime_variables (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('character', 'location', 'item', 'story_beat')),
  variable_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  variable_type TEXT NOT NULL CHECK(variable_type IN ('text', 'number', 'enum')),
  default_value TEXT,
  min_value REAL,
  max_value REAL,
  enum_options TEXT,
  color TEXT NOT NULL DEFAULT '#6366f1',
  icon TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (pack_id) REFERENCES preset_packs(id) ON DELETE CASCADE,
  UNIQUE(pack_id, entity_type, variable_name)
);

CREATE INDEX IF NOT EXISTS idx_pack_runtime_variables_pack ON pack_runtime_variables(pack_id);
CREATE INDEX IF NOT EXISTS idx_pack_runtime_variables_entity ON pack_runtime_variables(pack_id, entity_type);
