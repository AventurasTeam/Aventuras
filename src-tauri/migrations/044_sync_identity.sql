-- Sync identity and version vectors; see docs/architecture/sync.md.
--
-- A migration that rewrites rows in any table named by a trigger below must hold a row in
-- sync_suspend while it does, or every synced item reads as edited after the update.

CREATE TABLE sync_identity (
    entity_type TEXT NOT NULL,
    local_id TEXT NOT NULL,
    sync_id TEXT NOT NULL UNIQUE,
    PRIMARY KEY (entity_type, local_id)
);

CREATE TABLE sync_vector (
    sync_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    last_synced_at INTEGER,
    PRIMARY KEY (sync_id, device_id)
);

CREATE TABLE sync_device (
    device_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    is_self INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX idx_sync_device_self ON sync_device(is_self) WHERE is_self = 1;

CREATE TABLE sync_suspend (reason TEXT NOT NULL);

-- The name is empty until the app fills in its platform default.
INSERT INTO sync_device (device_id, name, is_self) VALUES (lower(hex(randomblob(16))), '', 1);

-- Before the triggers exist, so it counts as nobody's edit.
UPDATE stories SET updated_at = (
    SELECT MAX(stories.updated_at, MAX(e.created_at)) FROM story_entries e WHERE e.story_id = stories.id
)
WHERE EXISTS (
    SELECT 1 FROM story_entries e WHERE e.story_id = stories.id AND e.created_at > stories.updated_at
);

CREATE TRIGGER sync_edit_character_vault AFTER UPDATE OF name, description, traits, visual_descriptors, portrait, tags, metadata ON character_vault
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'character' AND i.local_id = NEW.id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_delete_character_vault AFTER DELETE ON character_vault
BEGIN
  DELETE FROM sync_vector WHERE sync_id IN
    (SELECT sync_id FROM sync_identity WHERE entity_type = 'character' AND local_id = OLD.id);
  DELETE FROM sync_identity WHERE entity_type = 'character' AND local_id = OLD.id;
END;

CREATE TRIGGER sync_edit_lorebook_vault AFTER UPDATE OF name, description, entries, tags, metadata ON lorebook_vault
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'lorebook' AND i.local_id = NEW.id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_delete_lorebook_vault AFTER DELETE ON lorebook_vault
BEGIN
  DELETE FROM sync_vector WHERE sync_id IN
    (SELECT sync_id FROM sync_identity WHERE entity_type = 'lorebook' AND local_id = OLD.id);
  DELETE FROM sync_identity WHERE entity_type = 'lorebook' AND local_id = OLD.id;
END;

CREATE TRIGGER sync_edit_scenario_vault AFTER UPDATE OF name, description, setting_seed, npcs, primary_character_name, first_message, alternate_greetings, tags, metadata, starting_time ON scenario_vault
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'scenario' AND i.local_id = NEW.id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_delete_scenario_vault AFTER DELETE ON scenario_vault
BEGIN
  DELETE FROM sync_vector WHERE sync_id IN
    (SELECT sync_id FROM sync_identity WHERE entity_type = 'scenario' AND local_id = OLD.id);
  DELETE FROM sync_identity WHERE entity_type = 'scenario' AND local_id = OLD.id;
END;

CREATE TRIGGER sync_edit_preset_packs AFTER UPDATE OF name, description, author ON preset_packs
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'pack' AND i.local_id = NEW.id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_delete_preset_packs AFTER DELETE ON preset_packs
BEGIN
  DELETE FROM sync_vector WHERE sync_id IN
    (SELECT sync_id FROM sync_identity WHERE entity_type = 'pack' AND local_id = OLD.id);
  DELETE FROM sync_identity WHERE entity_type = 'pack' AND local_id = OLD.id;
END;

CREATE TRIGGER sync_edit_stories AFTER UPDATE OF title, description, genre, template_id, settings, memory_config, mode, custom_variable_values ON stories
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_delete_stories AFTER DELETE ON stories
BEGIN
  DELETE FROM sync_vector WHERE sync_id IN
    (SELECT sync_id FROM sync_identity WHERE entity_type = 'story' AND local_id = OLD.id);
  DELETE FROM sync_identity WHERE entity_type = 'story' AND local_id = OLD.id;
END;

CREATE TRIGGER sync_edit_pack_templates_ins AFTER INSERT ON pack_templates
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE preset_packs SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.pack_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'pack' AND i.local_id = NEW.pack_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_pack_templates_upd AFTER UPDATE ON pack_templates
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE preset_packs SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.pack_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'pack' AND i.local_id = NEW.pack_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_pack_templates_del AFTER DELETE ON pack_templates
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE preset_packs SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = OLD.pack_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'pack' AND i.local_id = OLD.pack_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_pack_variables_ins AFTER INSERT ON pack_variables
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE preset_packs SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.pack_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'pack' AND i.local_id = NEW.pack_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_pack_variables_upd AFTER UPDATE ON pack_variables
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE preset_packs SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.pack_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'pack' AND i.local_id = NEW.pack_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_pack_variables_del AFTER DELETE ON pack_variables
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE preset_packs SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = OLD.pack_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'pack' AND i.local_id = OLD.pack_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_pack_runtime_variables_ins AFTER INSERT ON pack_runtime_variables
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE preset_packs SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.pack_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'pack' AND i.local_id = NEW.pack_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_pack_runtime_variables_upd AFTER UPDATE ON pack_runtime_variables
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE preset_packs SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.pack_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'pack' AND i.local_id = NEW.pack_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_pack_runtime_variables_del AFTER DELETE ON pack_runtime_variables
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE preset_packs SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = OLD.pack_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'pack' AND i.local_id = OLD.pack_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_story_entries_ins AFTER INSERT ON story_entries
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_story_entries_upd AFTER UPDATE ON story_entries
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_story_entries_del AFTER DELETE ON story_entries
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = OLD.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = OLD.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_characters_ins AFTER INSERT ON characters
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_characters_upd AFTER UPDATE ON characters
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_characters_del AFTER DELETE ON characters
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = OLD.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = OLD.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_locations_ins AFTER INSERT ON locations
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_locations_upd AFTER UPDATE ON locations
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_locations_del AFTER DELETE ON locations
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = OLD.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = OLD.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_items_ins AFTER INSERT ON items
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_items_upd AFTER UPDATE ON items
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_items_del AFTER DELETE ON items
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = OLD.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = OLD.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_story_beats_ins AFTER INSERT ON story_beats
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_story_beats_upd AFTER UPDATE ON story_beats
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_story_beats_del AFTER DELETE ON story_beats
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = OLD.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = OLD.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_entries_ins AFTER INSERT ON entries
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_entries_upd AFTER UPDATE ON entries
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_entries_del AFTER DELETE ON entries
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = OLD.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = OLD.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_chapters_ins AFTER INSERT ON chapters
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_chapters_upd AFTER UPDATE ON chapters
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_chapters_del AFTER DELETE ON chapters
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = OLD.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = OLD.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_branches_ins AFTER INSERT ON branches
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_branches_upd AFTER UPDATE ON branches
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_branches_del AFTER DELETE ON branches
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = OLD.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = OLD.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_checkpoints_ins AFTER INSERT ON checkpoints
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_checkpoints_upd AFTER UPDATE ON checkpoints
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_checkpoints_del AFTER DELETE ON checkpoints
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = OLD.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = OLD.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_embedded_images_ins AFTER INSERT ON embedded_images
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_embedded_images_upd AFTER UPDATE ON embedded_images
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_embedded_images_del AFTER DELETE ON embedded_images
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = OLD.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = OLD.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_time_anchors_ins AFTER INSERT ON time_anchors
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_time_anchors_upd AFTER UPDATE ON time_anchors
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;

CREATE TRIGGER sync_edit_time_anchors_del AFTER DELETE ON time_anchors
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  UPDATE stories SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = OLD.story_id;
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = OLD.story_id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;
