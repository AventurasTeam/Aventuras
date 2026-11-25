-- Everything State Tracking records, appended in write order and never rewritten.
--
-- kind 'header': one per narration classified while tracking is on, even when nothing
--   changed; carries whether tracking ran uninterrupted since the previous header on the
--   branch line.
-- kind 'change': one write to one entity. `entity_id` is the row actually written, which on a
--   lightweight branch can be an override or a tombstone. `before` holds the changed fields
--   (update) or the full row (delete); `after` is kept for every origin but the classifier.
-- kind 'break': tracking is interrupted here; no reconstruction crosses it.
CREATE TABLE IF NOT EXISTS world_state_changes (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL,
    branch_id TEXT,
    entry_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    kind TEXT NOT NULL,
    origin TEXT,
    entity_type TEXT,
    entity_id TEXT,
    op TEXT,
    before TEXT,
    after TEXT,
    continuous INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
    FOREIGN KEY (entry_id) REFERENCES story_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wsc_entry ON world_state_changes(entry_id, seq);
CREATE INDEX IF NOT EXISTS idx_wsc_story_branch ON world_state_changes(story_id, branch_id, seq);
CREATE INDEX IF NOT EXISTS idx_wsc_story_seq ON world_state_changes(story_id, seq);
