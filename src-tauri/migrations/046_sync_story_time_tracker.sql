-- A story's time tracker is part of its exported content, so editing it counts as an edit.
DROP TRIGGER sync_edit_stories;

CREATE TRIGGER sync_edit_stories AFTER UPDATE OF title, description, genre, template_id, settings, memory_config, mode, custom_variable_values, time_tracker ON stories
WHEN NOT EXISTS (SELECT 1 FROM sync_suspend)
BEGIN
  INSERT INTO sync_vector (sync_id, device_id, counter)
  SELECT i.sync_id, d.device_id, 1
  FROM sync_identity i, sync_device d
  WHERE i.entity_type = 'story' AND i.local_id = NEW.id AND d.is_self = 1
  ON CONFLICT (sync_id, device_id) DO UPDATE SET counter = counter + 1;
END;
