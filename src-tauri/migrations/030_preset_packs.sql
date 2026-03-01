-- Enable foreign keys (ensure enforcement for this migration)
PRAGMA foreign_keys = ON;

-- Pack metadata
CREATE TABLE IF NOT EXISTS preset_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  author TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(name)
);

-- Template content within packs
CREATE TABLE IF NOT EXISTS pack_templates (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (pack_id) REFERENCES preset_packs(id) ON DELETE CASCADE,
  UNIQUE(pack_id, template_id)
);

-- Custom variable definitions per pack
CREATE TABLE IF NOT EXISTS pack_variables (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL,
  variable_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  variable_type TEXT NOT NULL,
  is_required INTEGER NOT NULL DEFAULT 0,
  default_value TEXT,
  enum_options TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (pack_id) REFERENCES preset_packs(id) ON DELETE CASCADE,
  UNIQUE(pack_id, variable_name)
);

-- Track which story uses which pack
ALTER TABLE stories ADD COLUMN pack_id TEXT REFERENCES preset_packs(id) ON DELETE RESTRICT;

-- Seed default pack
INSERT INTO preset_packs (id, name, description, author, is_default, created_at, updated_at)
VALUES (
  'default-pack',
  'Default',
  'Built-in prompt templates shipped with Aventura',
  'Aventura',
  1,
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000
);

-- Assign default pack to all existing stories
UPDATE stories SET pack_id = 'default-pack' WHERE pack_id IS NULL;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_pack_templates_pack ON pack_templates(pack_id);
CREATE INDEX IF NOT EXISTS idx_pack_variables_pack ON pack_variables(pack_id);
CREATE INDEX IF NOT EXISTS idx_stories_pack ON stories(pack_id);
