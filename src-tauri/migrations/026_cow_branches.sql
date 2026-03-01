-- Phase 3: Copy-on-Write branch support
-- overrides_id links a branch entity to the parent entity it overrides.
-- NULL = original entity (not an override).
-- When a COW branch modifies an inherited entity, a new row is created
-- with overrides_id pointing to the original entity's id.

ALTER TABLE characters ADD COLUMN overrides_id TEXT;
ALTER TABLE locations ADD COLUMN overrides_id TEXT;
ALTER TABLE items ADD COLUMN overrides_id TEXT;
ALTER TABLE story_beats ADD COLUMN overrides_id TEXT;
ALTER TABLE entries ADD COLUMN overrides_id TEXT;
