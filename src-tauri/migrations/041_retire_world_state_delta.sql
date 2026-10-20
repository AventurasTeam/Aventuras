-- Moves every old per-entry world_state_delta into world_state_changes, strips the copies kept in
-- checkpoints, drops the column, and gives every snapshot, checkpoint and chapter its mark. The
-- conversion produces exactly what fromWorldStateDelta builds (services/stateTracking/legacy.ts);
-- the fixture next to it is asserted against both.
--
-- A converted header is marked by origin 'legacy': it recorded the classifier only. Its rows sort
-- below every existing seq, and an entry that already has a header of its own is skipped.

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
parts (entry_id, story_id, branch_id, position, created_at, grp, k, kind, origin, entity_type,
       entity_id, op, before) AS (
    SELECT id, story_id, branch_id, position, created_at, 0, 0, 'header', 'legacy',
           NULL, NULL, NULL, NULL
    FROM src
    UNION ALL
    SELECT s.id, s.story_id, s.branch_id, s.position, s.created_at, 1, j.key, 'change',
           'classifier', 'character', json_extract(j.value, '$.id'), 'update',
           json_remove(j.value, '$.id', '$.name', '$.title')
    FROM src s, json_each(s.d, '$.previousState.characters') j
    WHERE json_type(s.d, '$.previousState.characters') = 'array'
    UNION ALL
    SELECT s.id, s.story_id, s.branch_id, s.position, s.created_at, 2, j.key, 'change',
           'classifier', 'location', json_extract(j.value, '$.id'), 'update',
           json_remove(j.value, '$.id', '$.name', '$.title')
    FROM src s, json_each(s.d, '$.previousState.locations') j
    WHERE json_type(s.d, '$.previousState.locations') = 'array'
    UNION ALL
    SELECT s.id, s.story_id, s.branch_id, s.position, s.created_at, 3, j.key, 'change',
           'classifier', 'item', json_extract(j.value, '$.id'), 'update',
           json_remove(j.value, '$.id', '$.name', '$.title')
    FROM src s, json_each(s.d, '$.previousState.items') j
    WHERE json_type(s.d, '$.previousState.items') = 'array'
    UNION ALL
    SELECT s.id, s.story_id, s.branch_id, s.position, s.created_at, 4, j.key, 'change',
           'classifier', 'story_beat', json_extract(j.value, '$.id'), 'update',
           json_remove(j.value, '$.id', '$.name', '$.title')
    FROM src s, json_each(s.d, '$.previousState.storyBeats') j
    WHERE json_type(s.d, '$.previousState.storyBeats') = 'array'
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
    UNION ALL
    SELECT s.id, s.story_id, s.branch_id, s.position, s.created_at, 6, j.key, 'change',
           'classifier', 'character', j.value, 'create', NULL
    FROM src s, json_each(s.d, '$.createdEntities.characterIds') j
    WHERE json_type(s.d, '$.createdEntities.characterIds') = 'array'
    UNION ALL
    SELECT s.id, s.story_id, s.branch_id, s.position, s.created_at, 7, j.key, 'change',
           'classifier', 'location', j.value, 'create', NULL
    FROM src s, json_each(s.d, '$.createdEntities.locationIds') j
    WHERE json_type(s.d, '$.createdEntities.locationIds') = 'array'
    UNION ALL
    SELECT s.id, s.story_id, s.branch_id, s.position, s.created_at, 8, j.key, 'change',
           'classifier', 'item', j.value, 'create', NULL
    FROM src s, json_each(s.d, '$.createdEntities.itemIds') j
    WHERE json_type(s.d, '$.createdEntities.itemIds') = 'array'
    UNION ALL
    SELECT s.id, s.story_id, s.branch_id, s.position, s.created_at, 9, j.key, 'change',
           'classifier', 'story_beat', j.value, 'create', NULL
    FROM src s, json_each(s.d, '$.createdEntities.storyBeatIds') j
    WHERE json_type(s.d, '$.createdEntities.storyBeatIds') = 'array'
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

-- kind 'mark': where a snapshot, a checkpoint or a chapter was made in the write order.
-- `entity_type` names which and `entity_id` its row; the entry is the snapshot's, the
-- checkpoint's last or the chapter's end. A snapshot or checkpoint holds every record before its
-- mark, and a chapter's lore is recorded after its own, so reading the order compares `seq`
-- rather than creation times.
--
-- Existing ones are placed, then every row of a story is renumbered from 1 in that order. Among
-- the rows converted above (seq <= 0) a mark goes after those of entries up to its own: an old
-- snapshot or checkpoint was taken with its entry the latest classified, and a converted row's
-- time is its entry's, which a sync or import resets. Among rows written since (seq > 0) it goes
-- after the last one written by the time it was made.

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
UNION ALL
SELECT 'mark:chapter:' || ch.id, ch.story_id, ch.branch_id, ch.end_entry_id, 0, 'mark', NULL,
       'chapter', ch.id, NULL, NULL, NULL, NULL, ch.created_at
FROM chapters ch
WHERE EXISTS (SELECT 1 FROM story_entries e WHERE e.id = ch.end_entry_id);

-- Each mark's key is a running maximum over the story's rows: among rows written since, in time
-- order; among converted rows, in entry order. One pass each, not a lookup per mark.
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
WHERE ordered.id = world_state_changes.id;
