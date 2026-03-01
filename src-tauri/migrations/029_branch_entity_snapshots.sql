-- Add snapshot_complete flag to branches.
-- When set, the branch has its own complete entity set (copied at creation time)
-- and does NOT need lineage resolution. This ensures full isolation between branches.
ALTER TABLE branches ADD COLUMN snapshot_complete INTEGER NOT NULL DEFAULT 0;
