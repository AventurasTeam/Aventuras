-- In-story times the reader asserts about when an entry ended.
--
-- Every other timestamp in the database is derived output of the classifier's four-bucket
-- time progression; an anchor is the only record of what the reader knows to be true, and
-- the only thing a repair measures from.
--
-- UNIQUE on entry_id: one assertion per entry, so re-anchoring replaces rather than
-- accumulates.
--
-- ON DELETE CASCADE is safe only while no path deletes an entry and re-inserts it under
-- the same id. The cascade cannot tell those apart, so a delete-then-reinsert restore
-- would silently destroy every anchor in the story. The one such path -- checkpoint
-- restoration -- is deprecated and unreachable; if it is ever revived it must prune
-- anchors whose entry is absent from the snapshot AFTER re-inserting, not rely on this key.
CREATE TABLE IF NOT EXISTS time_anchors (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL,
    entry_id TEXT NOT NULL UNIQUE,
    asserted_time TEXT NOT NULL,    -- JSON TimeTracker: the time the reader says this entry ended
    note TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
    FOREIGN KEY (entry_id) REFERENCES story_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_time_anchors_story ON time_anchors(story_id);
