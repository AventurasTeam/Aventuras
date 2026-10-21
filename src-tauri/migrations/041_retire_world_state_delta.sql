-- Converts world_state_delta into records and drops it, then marks snapshots, checkpoints and
-- chapters; see docs/architecture/state-tracking.md. Matches fromWorldStateDelta (legacy.ts).

INSERT INTO world_state_changes
    (id, story_id, branch_id, entry_id, seq, kind, origin, entity_type, entity_id, op,
     before, after, continuous, created_at)
WITH src AS MATERIALIZED (
    SELECT e.id, e.story_id, e.branch_id, e.position, e.created_at, e.world_state_delta AS d
    FROM story_entries e
    WHERE e.world_state_delta IS NOT NULL
      AND (CASE WHEN json_valid(e.world_state_delta) THEN json_type(e.world_state_delta) END) = 'object'
      AND NOT EXISTS (
          SELECT 1 FROM world_state_changes w WHERE w.entry_id = e.id AND w.kind = 'header')
),
-- The delta's lists, in the order their records are numbered; the scene comes between them (5).
lists (grp, path, entity_type, op) AS (
    VALUES (1, '$.previousState.characters', 'character', 'update'),
           (2, '$.previousState.locations', 'location', 'update'),
           (3, '$.previousState.items', 'item', 'update'),
           (4, '$.previousState.storyBeats', 'story_beat', 'update'),
           (6, '$.createdEntities.characterIds', 'character', 'create'),
           (7, '$.createdEntities.locationIds', 'location', 'create'),
           (8, '$.createdEntities.itemIds', 'item', 'create'),
           (9, '$.createdEntities.storyBeatIds', 'story_beat', 'create')
),
parts (entry_id, story_id, branch_id, position, created_at, grp, k, kind, origin, entity_type,
       entity_id, op, before) AS (
    SELECT id, story_id, branch_id, position, created_at, 0, 0, 'header', 'legacy',
           NULL, NULL, NULL, NULL
    FROM src
    UNION ALL
    SELECT s.id, s.story_id, s.branch_id, s.position, s.created_at, l.grp, j.key, 'change',
           'classifier', l.entity_type,
           CASE l.op WHEN 'update' THEN json_extract(j.value, '$.id') ELSE j.value END, l.op,
           CASE l.op WHEN 'update' THEN json_remove(j.value, '$.id', '$.name', '$.title') END
    FROM src s, lists l, json_each(s.d, l.path) j
    WHERE json_type(s.d, l.path) = 'array'
    UNION ALL
    -- The scene the entry left: the new one's before-state is among the locations, or it was
    -- created. Skipped when there was none, or its own before-state is listed.
    SELECT s.id, s.story_id, s.branch_id, s.position, s.created_at, 5, 0, 'change',
           'classifier', 'location', json_extract(s.d, '$.previousState.currentLocationId'),
           'update', '{"current":true}'
    FROM src s
    WHERE json_type(s.d, '$.previousState.currentLocationId') = 'text'
      AND NOT EXISTS (
          SELECT 1 FROM json_each(s.d, '$.previousState.locations') l
          WHERE json_extract(l.value, '$.id')
              = json_extract(s.d, '$.previousState.currentLocationId'))
),
numbered AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY entry_id ORDER BY grp, k) - 1 AS n
    FROM parts
)
SELECT
    CASE WHEN kind = 'header' THEN entry_id || ':header' ELSE entry_id || ':' || n END,
    story_id,
    branch_id,
    entry_id,
    ROW_NUMBER() OVER (PARTITION BY story_id ORDER BY position, entry_id, n)
        - COUNT(*) OVER (PARTITION BY story_id),
    kind,
    origin,
    entity_type,
    entity_id,
    op,
    before,
    NULL,
    CASE WHEN kind = 'header' THEN 0 END,
    created_at
FROM numbered;

-- ORDER BY key keeps the array order, which json_group_array alone does not promise.
UPDATE checkpoints
SET entries_snapshot = (
    SELECT json_group_array(json_remove(value, '$.worldStateDelta') ORDER BY key)
    FROM json_each(entries_snapshot))
WHERE json_valid(entries_snapshot) AND entries_snapshot LIKE '%"worldStateDelta"%';

ALTER TABLE story_entries DROP COLUMN world_state_delta;

-- Marks: placed by entry among converted rows (seq <= 0), by time among later ones.

INSERT INTO world_state_changes
    (id, story_id, branch_id, entry_id, seq, kind, origin, entity_type, entity_id, op,
     before, after, continuous, created_at)
SELECT 'mark:snapshot:' || s.id, s.story_id, s.branch_id, s.entry_id, 0, 'mark', NULL,
       'snapshot', s.id, NULL, NULL, NULL, NULL, s.created_at
FROM world_state_snapshots s
WHERE EXISTS (SELECT 1 FROM story_entries e WHERE e.id = s.entry_id)
UNION ALL
-- A checkpoint belongs to the branch of its entry.
SELECT 'mark:checkpoint:' || c.id, c.story_id, e.branch_id, c.last_entry_id, 0, 'mark', NULL,
       'checkpoint', c.id, NULL, NULL, NULL, NULL, c.created_at
FROM checkpoints c
JOIN story_entries e ON e.id = c.last_entry_id
-- At a fork point it may hold a child's state; unmarked, it is never an anchor.
WHERE NOT EXISTS (SELECT 1 FROM branches b WHERE b.fork_entry_id = c.last_entry_id)
UNION ALL
SELECT 'mark:chapter:' || ch.id, ch.story_id, ch.branch_id, ch.end_entry_id, 0, 'mark', NULL,
       'chapter', ch.id, NULL, NULL, NULL, NULL, ch.created_at
FROM chapters ch
WHERE EXISTS (SELECT 1 FROM story_entries e WHERE e.id = ch.end_entry_id);

-- A mark's key is a running maximum of seq, in time order and in entry order.
WITH placed AS (
    SELECT w.id, w.story_id, w.seq, w.created_at, e.position,
           CASE WHEN w.kind = 'mark' THEN 1 ELSE 0 END AS m
    FROM world_state_changes w
    LEFT JOIN story_entries e ON e.id = w.entry_id
),
reached AS (
    SELECT id, story_id, seq, created_at, m,
           MAX(CASE WHEN m = 0 AND seq > 0 THEN seq END) OVER (
               PARTITION BY story_id ORDER BY created_at, m
               ROWS UNBOUNDED PRECEDING) AS by_time,
           MAX(CASE WHEN m = 0 AND seq <= 0 THEN seq END) OVER (
               PARTITION BY story_id ORDER BY position, m
               ROWS UNBOUNDED PRECEDING) AS by_entry
    FROM placed
),
keyed AS (
    SELECT id, story_id,
           CASE WHEN m = 0 THEN seq
                ELSE COALESCE(by_time, by_entry, -9223372036854775807) END AS k,
           m, created_at AS t
    FROM reached
),
ordered AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY story_id ORDER BY k, m, t, id) AS rn
    FROM keyed
)
UPDATE world_state_changes
SET seq = ordered.rn
FROM ordered
WHERE ordered.id = world_state_changes.id AND world_state_changes.seq IS NOT ordered.rn;

-- For reading a branch line's marks.
CREATE INDEX IF NOT EXISTS idx_wsc_marks ON world_state_changes(story_id, branch_id, seq)
    WHERE kind = 'mark';

-- A mark's id is 'mark:<entity_type>:<entity_id>', so it goes with what it marks by key.

CREATE TRIGGER IF NOT EXISTS wsc_mark_snapshot_gone AFTER DELETE ON world_state_snapshots
BEGIN
    DELETE FROM world_state_changes WHERE id = 'mark:snapshot:' || OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS wsc_mark_checkpoint_gone AFTER DELETE ON checkpoints
BEGIN
    DELETE FROM world_state_changes WHERE id = 'mark:checkpoint:' || OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS wsc_mark_chapter_gone AFTER DELETE ON chapters
BEGIN
    DELETE FROM world_state_changes WHERE id = 'mark:chapter:' || OLD.id;
END;
