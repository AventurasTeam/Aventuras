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

Three knobs per story. Defaults copied from
`app_settings.default_story_settings` at story creation.

| Knob                             | Effect                                                                                                                                                            | Foot-shooting check                                                                                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fullChapterInBuffer` (boolean)  | Two-mode axis. `true` = full current chapter verbatim. `false` = last `partialChapterBuffer` entries of current chapter.                                          | UI shows token cost at chapter threshold when on ("at the chapter threshold this consumes ~X tokens"). Off-mode token cost is bounded by `partialChapterBuffer`.   |
| `partialChapterBuffer` (entries) | Size of the current-chapter slice when `fullChapterInBuffer = false`. Ignored in full mode.                                                                       | Interacts with `classifierCadence` — see Buffer-aware cadence indicator below.                                                                                     |
| `protectedBuffer` (entries)      | Chapter-boundary spillover floor. Applies in **both** modes. If the current chapter has fewer entries than this floor, fill from the previous chapter to satisfy. | Floor for fresh-chapter "the LLM has no recent history" risk; keeps writing style consistent across boundaries. Set too low and a fresh chapter starts threadbare. |
| `classifierCadence` (turns)      | When the periodic classifier runs in the background.                                                                                                              | UI warns in partial mode when cadence > `partialChapterBuffer` (unclassified turns slide out of the window before classifier catches up). Suppressed in full mode. |

### Composition rule

- **Partial mode** (`fullChapterInBuffer = false`): LLM gets the
  last `partialChapterBuffer` entries from the current chapter. If
  the current chapter has fewer entries than `protectedBuffer`,
  fill from the previous chapter to satisfy the `protectedBuffer`
  floor. Total entries =
  `max(partialChapterBuffer, protectedBuffer)` once the chapter
  is past `protectedBuffer` entries; before that, total =
  `protectedBuffer` (with previous-chapter spillover making up
  the gap).
- **Full mode** (`fullChapterInBuffer = true`): LLM gets ALL
  entries in the current chapter. If the current chapter has
  fewer entries than `protectedBuffer`, fill from the previous
  chapter to satisfy the `protectedBuffer` floor. Total entries =
  `max(current_chapter_size, protectedBuffer)`.

**Examples** (both buffers at default 10):

- partial, chapter 3 has 2 entries → 2 current + 8 previous = 10
- partial, chapter 3 has 10 entries → 10 current
- partial, chapter 3 has 50 entries → last 10 current (no spillover)
- full, chapter 3 has 2 entries → 2 current + 8 previous = 10
- full, chapter 3 has 50 entries → all 50 current (chapter size
  exceeds protected floor; no spillover needed)

### Buffer-aware cadence indicator — partial mode only

In partial mode, the cadence has to keep pace with the partial
window so unclassified turns don't fall out of LLM coverage
before the classifier catches up. Story Settings UI shows the
relationship: "with partial chapter buffer = 10 entries and
cadence = 8 turns, you have 2 turns of coverage overlap." Drop
overlap below zero, get a warning chip.

**Full mode suppresses the warning.** Full mode keeps the entire
current chapter in context, and chapter-close phase 0 catches up
any unclassified entries before lore-mgmt runs. No eviction risk;
the cadence warning is hidden entirely.

### Where these live

`stories.settings`:

```ts
{
  fullChapterInBuffer: boolean,    // default false
  partialChapterBuffer: number,    // entries; default 10
  protectedBuffer: number,         // entries; default 10
  classifierCadence: number        // turns; v1 ships entry-counted only — see parked.md → Token-trigger classifier cadence
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
field sets, with one documented overlap on `entities.status`.

| Field                                                                    | Piggyback                                           | Classifier                                           |
| ------------------------------------------------------------------------ | --------------------------------------------------- | ---------------------------------------------------- |
| `story_entries.metadata` (current entry)                                 | ✓                                                   | —                                                    |
| `entities.state.visual.*`                                                | ✓                                                   | —                                                    |
| `entities.state` (location, equipped, inventory, stackables, lastSeenAt) | ✓                                                   | —                                                    |
| `entities.status`                                                        | ✓ (staged → active only, on `sceneEntities` ID hit) | ✓ (staged → active slow path; active → retired)      |
| `entities.description`                                                   | —                                                   | ✓ (first introduction only; see authorship contract) |
| `happenings`                                                             | —                                                   | ✓                                                    |
| `happening_involvements`                                                 | —                                                   | ✓                                                    |
| `happening_awareness`                                                    | —                                                   | ✓                                                    |

**Field-overlap invariant.** `entities.status` is the only field
both writers touch. They never collide on the same entity at the
same time because the staged→active transition is monotonic:
whichever writer arrives first lands `status='active'`; the other
reads `active` and no-ops. Piggyback never writes active→retired
(classifier-only). So while concurrent runs CAN write the same
field, they cannot write the same row to different values.

The only shared row is `entities`, and field-level disjointness
holds for everything except the `status`-overlap above. With
**per-field UPDATEs** (no row-level read-modify-write cycles) and
the monotonic-status invariant, SQLite serializes the writes
without clobbering even when both writers target the same row.
The discipline at the action layer:

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
