-- Phase 1: Record world state changes per story entry
ALTER TABLE story_entries ADD COLUMN world_state_delta TEXT;

-- Phase 1: Auto-snapshots for fast state reconstruction
CREATE TABLE IF NOT EXISTS world_state_snapshots (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL,
    branch_id TEXT,
    entry_id TEXT NOT NULL,
    entry_position INTEGER NOT NULL,
    characters_snapshot TEXT NOT NULL,
    locations_snapshot TEXT NOT NULL,
    items_snapshot TEXT NOT NULL,
    story_beats_snapshot TEXT NOT NULL,
    lorebook_entries_snapshot TEXT,
    time_tracker_snapshot TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
    FOREIGN KEY (entry_id) REFERENCES story_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wss_story_branch
  ON world_state_snapshots(story_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_wss_position
  ON world_state_snapshots(story_id, branch_id, entry_position);
CREATE INDEX IF NOT EXISTS idx_wss_entry
  ON world_state_snapshots(entry_id);
