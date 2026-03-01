-- Copy-on-Delete (COD) tombstone support for COW branches.
-- When a COW branch deletes an inherited entity, instead of removing the parent row,
-- we create an override marked as deleted (a "tombstone"). The resolution methods
-- skip tombstoned entities, making the delete local to the branch.

ALTER TABLE characters ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE locations ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE story_beats ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entries ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
