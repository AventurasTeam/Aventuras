# Cadence

Three agents touch memory state at different time scales.

| Layer                      | Trigger                                                                  | Scope                                                                          |
| -------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| **Piggyback**              | Every AI reply, inline on the narrative call                             | Scene-local fast-mutating state                                                |
| **Periodic classifier**    | Background, every N turns or token-budget-tied to recent-buffer eviction | Multi-turn batch extractions                                                   |
| **Chapter-close pipeline** | Token threshold crossed OR user-triggered                                | 5 phases: catch-up classifier, boundary, metadata, lore-mgmt, lifecycle review |

Two architectural drivers shape the stratification:

- **Contradiction prevention.** Piggyback writes the crucial subset on
  the same call that produces the prose, so the prose and the state
  it produces are mutually consistent by construction. The periodic
  classifier keeps the deeper graph (happenings, awareness, status)
  in lockstep with prose for non-crucial surfaces.
- **Cost.** Piggyback adds a few hundred output tokens to a call
  that's already paying its full input cost. A separate per-turn
  classifier would pay duplicate input cost on the same context window
  (potentially ~60k tokens), which dominates per-turn cost even on
  cheap models. The periodic classifier amortizes that cost over many
  turns.

See per-layer detail in [`piggyback.md`](./piggyback.md),
[`classifier.md`](./classifier.md), and
[`chapter-close.md`](./chapter-close.md).

## Why classifier stays essential

Even with [`fullChapterInBuffer`](#user-tunable-knobs) mode active,
the classifier is essential, not optional. The prose being in-buffer
helps the LLM during generation; **retrieval queries the structured
awareness graph, not the prose**. Cross-chapter retrieval needs
structured rows. A chapter-30 turn whose retrieval needs "what does
Aria know from chapter 5" can't glance at chapter 5's prose; the
awareness rows are the indexable surface. The classifier populates
them.

---

## User-tunable knobs

Three orthogonal user-tunable settings per story. Defaults copied
from `app_settings.default_story_settings` at story creation.

| Knob                                         | Effect                                                                                      | Foot-shooting check                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `recentBuffer` (entries)                     | Last N entries verbatim in LLM context, regardless of chapter boundaries                    | None directly; interacts with classifier cadence                                                                          |
| `fullChapterInBuffer` (boolean)              | Current chapter always verbatim in LLM context, **in addition to** the `recentBuffer` slice | UI shows token cost at threshold ("at the chapter threshold this consumes ~X tokens")                                     |
| `classifierCadence` (turns or token trigger) | When the periodic classifier runs in the background                                         | UI warns when cadence > buffer eviction horizon for un-classified turns; cadence relaxes when `fullChapterInBuffer` is on |

The two buffer settings compose orthogonally. With
`fullChapterInBuffer = true` and `recentBuffer = 10`, the LLM gets
the entire current chapter verbatim plus the last 10 entries before
it (spillover from the previous chapter). With
`fullChapterInBuffer = false` and `recentBuffer = 10`, just the last
10 entries.

**Buffer-aware cadence indicator.** When `fullChapterInBuffer = false`,
the cadence has to keep pace with recent-buffer eviction so unclassified
turns don't fall out of LLM coverage before the classifier catches up.
Story Settings UI shows the relationship: "with current buffer = 10
entries and cadence = 8 turns, you have 2 turns of coverage overlap."
Drop overlap below zero, get a warning chip.

**fullChapterInBuffer relaxation.** When on, the classifier's urgency
drops to "before chapter close." Foot-shooting indicator hides because
the prose is always in LLM context regardless of cadence.

### Where these live

`stories.settings`:

```ts
{
  recentBuffer: number,           // entries; default 10
  fullChapterInBuffer: boolean,   // default false
  classifierCadence: { mode: 'turns' | 'token-trigger', value: number }
  // existing memory knobs continue: chapterTokenThreshold, chapterAutoClose
}
```

`compactionDetail` (a freeform user prose directive on
`stories.settings`) is **dropped** in this design pass. The original
"memory-compaction agent" it directed no longer exists — chapter-
close lore-mgmt subsumes it, and a one-line soft hint adds marginal
value at the cost of UX surface. Power users can author packs that
bias prompts more rigorously.

`chapterTokenThreshold` and `chapterAutoClose` stay alongside.

---

## Concurrency

The piggyback agent and the periodic classifier write to disjoint
field sets, even when they share row identifiers.

| Field                                                                    | Piggyback | Classifier                                           |
| ------------------------------------------------------------------------ | --------- | ---------------------------------------------------- |
| `story_entries.metadata` (current entry)                                 | ✓         | —                                                    |
| `entities.state.visual.*`                                                | ✓         | —                                                    |
| `entities.state` (location, equipped, inventory, stackables, lastSeenAt) | ✓         | —                                                    |
| `entities.status`                                                        | —         | ✓ (staged → active, active → retired)                |
| `entities.description`                                                   | —         | ✓ (first introduction only; see authorship contract) |
| `happenings`                                                             | —         | ✓                                                    |
| `happening_involvements`                                                 | —         | ✓                                                    |
| `happening_awareness`                                                    | —         | ✓                                                    |

The only shared row is `entities`, and field-level disjointness holds.
With **per-field UPDATEs** (no row-level read-modify-write cycles),
SQLite serializes the two writes without clobbering. The discipline at
the action layer:

```ts
// Yes — independent UPDATE statements:
db.execute('UPDATE entities SET status = ? WHERE id = ?', [...])
db.execute('UPDATE entities SET state = json_patch(state, ?) WHERE id = ?', [...])

// No — read-modify-write loses concurrent writes:
const entity = db.queryOne('SELECT * FROM entities WHERE id = ?', [id])
entity.status = 'active'
entity.state = { ...entity.state, ...patches }
db.execute('UPDATE entities SET status = ?, state = ? WHERE id = ?', [entity.status, entity.state, id])
```

Zustand actions enforce per-field-or-per-state-patch updates, so the
underlying SQLite UPDATEs are independent. Optimistic concurrency
(detect rare conflict, retry) covers the residual collision case.

### Single-writer-per-write-set in v1

The background classifier is the first agent that runs concurrent
with the per-turn pipeline. The user-edit gate (UI-side disabling of
controls during pipeline runs) does **not** relax — user edits already
operate at field granularity and respect the same write-set
boundaries.

`'concurrent-allowed'` was previously theoretical in
[`architecture.md`](../architecture.md); the periodic classifier is its
first real consumer and triggers documenting the value.
