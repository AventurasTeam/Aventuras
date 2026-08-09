-- Pairs of entities the user has declared to be different subjects.
--
-- The duplicate detector is deliberately lenient: it groups "Kael" with "Baron Kaelen" so
-- a human can decide. Without a memory of that decision it re-asks every time the window
-- is opened, which makes the second visit useless.
--
-- Keyed by normalized *name pair*, not by entity id, so a later rename or merge cannot
-- resurrect a decision that was already made. Stored per pair rather than per group
-- because grouping is transitive: a group of three can reappear as a group of two.
CREATE TABLE IF NOT EXISTS kept_separate (
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    branch_id TEXT,                 -- NULL = main branch
    pool TEXT NOT NULL,             -- 'character' | 'location' | 'item' | 'lorebook'
    pair_key TEXT NOT NULL,         -- two normalized names, sorted, joined by '|'
    created_at INTEGER NOT NULL,
    PRIMARY KEY (story_id, branch_id, pool, pair_key)
);

CREATE INDEX IF NOT EXISTS idx_kept_separate_story ON kept_separate(story_id, branch_id);
