# Cadence

Three agents touch memory state at different time scales.

| Layer                      | Trigger                                                                  | Scope                                                                                       |
| -------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| **Piggyback**              | Every AI reply, inline on the narrative call                             | Physical state a turn changes: scene, positions, holdings, visuals, condition               |
| **Periodic classifier**    | Chained after a turn, every N entries; blocks the story while it runs    | Facts evidenced across turns, and the first profile of what it creates                      |
| **Chapter-close pipeline** | Token threshold crossed OR user-triggered; chained after the turn's pass | 5 phases: catch-up passes, boundary, metadata, lore management and upkeep, lifecycle review |

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

  The per-turn **fallback** classifier pays exactly that duplicate cost,
  knowingly. It carries near-narrative context so it can produce
  equivalent output — including
  [the retrieval queries](./retrieval.md#q4-classifier-emitted-queries),
  which cannot be answered without seeing what the turn was given (see
  [`piggyback.md → Fallback classifier context`](./piggyback.md#fallback-classifier-context)).
  This is affordable because it is the exception path: with piggyback
  on, it fires only when a block fails to parse. A model that
  permanently fails the capability gate pays it every turn, which is a
  known consequence of the gate rather than a defect.

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

Five knobs per story. Defaults copied from
`app_settings.default_story_settings` at story creation.

| Knob                                 | Effect                                                                                                                                                                                                                  | Foot-shooting check                                                                                                                                                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fullChapterInBuffer` (boolean)      | Two-mode axis. `true` = full current chapter verbatim. `false` = last `partialChapterBuffer` entries of current chapter.                                                                                                | UI shows token cost at chapter threshold when on ("at the chapter threshold this consumes ~X tokens"). Off-mode token cost is bounded by `partialChapterBuffer`.                                                                   |
| `partialChapterBuffer` (entries)     | Size of the current-chapter slice when `fullChapterInBuffer = false`. Ignored in full mode.                                                                                                                             | Interacts with `classifierCadence` — see Buffer-aware cadence indicator below.                                                                                                                                                     |
| `protectedBuffer` (entries)          | Chapter-boundary spillover floor. Applies in **both** modes. If the current chapter has fewer entries than this floor, fill from the previous chapter to satisfy.                                                       | Floor for fresh-chapter "the LLM has no recent history" risk; keeps writing style consistent across boundaries. Set too low and a fresh chapter starts threadbare.                                                                 |
| `classifierCadence` (entries)        | How many entries apart the periodic classifier runs.                                                                                                                                                                    | UI warns in partial mode when the cadence plus one exceeds `partialChapterBuffer` (unclassified entries slide out of the window before classifier catches up) — see Buffer-aware cadence indicator below. Suppressed in full mode. |
| `classifierContextEntries` (entries) | How many trailing entries the per-turn fallback classifier sees. Minimum 2 — the fixed action-plus-reply pair it extracts from, which this knob must never be able to cut. Entries beyond the pair are background only. | Raising it widens what the classifier can reason over and raises the fallback's input cost on every turn it fires.                                                                                                                 |

### Composition rule

- **Partial mode** (`fullChapterInBuffer = false`): LLM gets the
  last `partialChapterBuffer` entries from the current chapter. If
  the current chapter has fewer entries than `protectedBuffer`,
  fill backwards from the chapter boundary to satisfy the
  `protectedBuffer` floor. Total entries =
  `max(protectedBuffer, min(current_chapter_size, partialChapterBuffer))`.
- **Full mode** (`fullChapterInBuffer = true`): LLM gets ALL
  entries in the current chapter. If the current chapter has
  fewer entries than `protectedBuffer`, fill backwards from the
  chapter boundary to satisfy the `protectedBuffer` floor. Total
  entries = `max(current_chapter_size, protectedBuffer)`.

**"Backwards from the boundary", not "from the previous chapter."**
The arithmetic above is unconditional, so when the previous chapter is
itself shorter than the remaining shortfall, the walk continues into
the one before it, and so on until the floor is met or the branch runs
out. A floor that silently stops one chapter short is not a floor. The
case is uncommon — `chapterTokenThreshold` defaults to 24000 tokens, so
a chapter normally holds far more than the default `protectedBuffer` of
10 — but a run of short chapters after a manual chapter-close makes it
reachable.

The current-chapter term is clamped to the chapter's own size in
both modes: `partialChapterBuffer` is a window over the current
chapter, never a claim on earlier prose. Only `protectedBuffer`
pulls entries from before the boundary, so a
`partialChapterBuffer` wider than the current chapter buys nothing.

**Examples** (both buffers at default 10):

- partial, chapter 3 has 2 entries → 2 current + 8 previous = 10
- partial, chapter 3 has 10 entries → 10 current
- partial, chapter 3 has 50 entries → last 10 current (no spillover)
- partial at `partialChapterBuffer = 20`, chapter 3 has 12 entries →
  12 current (the window clamps to the chapter; protected floor of
  10 is already met, so no spillover)
- full, chapter 3 has 2 entries → 2 current + 8 previous = 10
- full, chapter 3 has 50 entries → all 50 current (chapter size
  exceeds protected floor; no spillover needed)
- partial, chapter 3 has 2 entries and chapter 2 has 3 → 2 current +
  3 from chapter 2 + 5 from chapter 1 = 10 (the walk crosses more than
  one boundary rather than stopping at 5)

### Buffer-aware cadence indicator — partial mode only

In partial mode, the cadence has to keep pace with the partial
window so unclassified entries don't fall out of LLM coverage
before the classifier catches up. Story Settings UI shows the
relationship: "with partial chapter buffer = 10 entries and
cadence = 8 entries, you have 1 entry of coverage overlap." Drop
overlap below zero, get a warning chip.

The cadence is checked only after a completed turn, which writes
two entries, so a pass can fire one entry past the cadence. An odd
cadence always does; an even one does after a prose reversal (edit,
regenerate, rollback) leaves an odd number of entries unprocessed.
The indicator subtracts that worst case, cadence + 1, whatever the
parity: cadence 8 against a buffer of 10 is 1 entry of overlap.

A pass never spans turns: it chains from the turn's commit and holds
the gate, so no turn starts under it, and one a reversal interrupts
runs before the next turn instead
([`classifier.md → Pipeline framing`](./classifier.md#pipeline-framing)).
So cadence + 1 is the bound while passes succeed; a failed pass is
retried at the next turn's commit, two entries later.

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
  classifierCadence: number,       // entries; v1 ships entry-counted only — see parked.md → Token-trigger classifier cadence
  classifierContextEntries: number // entries; default 4, minimum 2 (the fixed pair)
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

The AI writers never run at once on a branch. The per-turn writer runs
inside its turn; a due pass chains from the turn's commit; a close
chains from the pass, or from the turn when no pass is due, and phase
0 chains passes ahead of it until the classifier is caught up
([`generation-pipeline.md → chainsTo on predecessor`](../generation-pipeline.md#chainsto-on-predecessor)).
All of them hold the user-edit gate, so World edits and Send wait for
them. A head reversal (regenerate, swipe, an edit of the head turn,
CTRL-Z of the turn, rollback) and Cancel interrupt a pass or a close,
which then runs before the next turn instead
([`generation-pipeline.md → Prose reversals and the interrupt`](../generation-pipeline.md#prose-reversals-and-the-interrupt)).
The one run that overlaps a pass or a close is suggestion refresh,
which writes only the head entry's chips, a field neither reads.

Because they run in sequence, a field can have more than one AI
writer: the later write wins, except where a user edit stands
([User edits and classifier writes](#user-edits-and-classifier-writes)).
Who writes what is the
[authorship contract](../data-model.md#authorship-contract). Both the
per-turn writer and a pass create places, and a pass runs after the
turn, so it matches against the turn's creates.

Writes that can still meet serialize per row: a user write against an
undo or redo, or against a reversal. Each action writes only the
columns it changes but computes them from a read of the row, so every
delta-logged write to an existing `entities` row, and every reversal of
one, serializes on a lock keyed by that row: one writer's read and
commit never straddle another's. `character_relationships` writes
serialize on one key per branch, since a delete names a row id, not a
pair. Involvement and awareness writes and a happening delete
serialize on one per-branch `happening_links` key, for the same reason.
An entity delete holds both link-family keys as well as its row key,
and every reversal or redo of these tables takes the same keys. A
shared JSON column no row lock covers, such as
`branches.classifier_status`, which the reversal clamp and the
classifier pipeline both write, is written with key-scoped `json_set`,
never a whole-blob read-modify-write.

### User edits and classifier writes

A pass and a close run under the gate, so no user edit lands while
they run. A user edit can still predate a pass but postdate the prose
it processes, since a pass works through the backlog of turns written
since the last one, and a close reads the whole chapter. Their writes
to existing rows resolve that, field by field, by the precedence below.
The per-turn writer needs none of it: its prose is always newer than
any user edit.

**Idempotent writes.** Status, keyword, faction and link writes check
the row or rows as they stand when the write lands:

- Promotion goes through `promoteStagedEntity`, a no-op unless the row
  is still `staged`; retirement through `retireEntity`, a no-op unless
  it is still `active`; a return from retirement is a no-op unless it
  is still `retired`. So a status the user changed since stands.
- Keywords go through `appendEntityKeywords`, which appends only terms
  the list lacks.
- A membership goes through `setCharacterFaction`, which writes
  `state.faction_id` alone. The handler no-ops when the row isn't a
  character, when a faction it names isn't a faction live or created
  earlier in the same action group (none needs no row), and when the
  faction already matches.
- Link rows go through `createHappeningInvolvement`,
  `upsertHappeningAwareness` and `upsertCharacterRelationship`. A create
  re-reads the rows it names — the entity and the happening, or both
  ends of a pair — and no-ops when one is gone; a row the same action
  group creates counts as present, in either order. Lock keys:
  [Concurrency](#concurrency).

**User precedence.** A field the user wrote after the prose a fact
came from keeps the user's value. Every write a pass or a close makes
to an existing row carries the fact's source entry, a close's the
latest entry it cites, and the delta log already orders both writers,
so nothing new is stored. That covers each field they update: status,
keywords, a name, a description, the identity fields, a place's parent
and condition, a faction's standing and agenda, a membership, link
rows, threads and lore:

- The prose's position is the log position of the entry's latest
  create or content-edit delta. An entry with neither predates the
  log, so every user edit outranks it.
- The user wrote a field after that prose when a `user_edit` delta on
  the same row, logged later, created the row or changed that column.
  `updateEntity` drops the columns a patch leaves unchanged, so an edit
  to a description does not shield the status. Inside `state` the
  check is per field: the undo payload holds only the fields an update
  changed, so an edit to a character's traits does not shield its
  faction.
- A status the user wrote after the prose stands: promotion and
  retirement no-op. The scene editor's staged-to-active promotion of an
  entity it brings into the scene is a user status write too.
- An alias the user removed after the prose stays removed. The same
  write's other new aliases still land.
- A faction the user set or cleared after the prose stands: the
  membership no-ops. A World delete or merge that re-points a
  character's faction is a user write to it too.

Undoing the user's edit removes its delta, which lifts the protection
for any pass that reads the prose afterwards. A pass the edit already
blocked has advanced its watermark past that prose, so the undo leaves
the field at its value from before the edit, not the prose's.
A later content edit of the source entry makes that prose newer than
the user's edit, so its facts win again when a pass re-reads the
entry: an edit to the head turn reopens it
([`data-model.md → Entry mutability & rollback`](../data-model.md#entry-mutability--rollback)),
and an entry still in the backlog is read anyway. An edit to an entry
a pass already processed, off the head turn, is not re-read.

**Relationship views.** The classifier's upsert writes one
perspective into the pair's row, and a view the user wrote after the
fact's prose stands: the upsert no-ops when a user write after that
prose created the row with that perspective set, or set that
perspective later. A pair the user deleted after the prose stays
deleted, since the upsert does not re-create it. A create that left
this perspective blank, or a user write of only the other one, leaves
it to the classifier; whether the create set it is read from the delta
chain, since the live row may hold a value the classifier filled in
since. This is how the authoring contract, where the classifier
updates a view on subsequent contradicting prose, is enforced
([`data-model.md → Character-to-character relationships`](../data-model.md#character-to-character-relationships)).

**Reversals.** Reversing a classifier fact for a prose edit, its undo
or redo, or a failed or interrupted pass keeps each field the user
wrote after the fact on a row the reversal leaves standing, field by
field inside `state`, so the precedence above never leaves a value
neither the user nor the prose chose. A membership's undo that would
put back a faction the user has deleted since writes none instead
([`generation-pipeline.md → Reverse-replay`](../generation-pipeline.md#reverse-replay)).
A pair the classifier created keeps a view the user added since
and loses the classifier's, and a pair the reversal would leave with no
view is deleted. A row the reversal deletes takes the user's edits to
it along too; the cases are below, under what stays open. A rollback or
regenerate differs: a World edit has no entry to survive on, so the
user's later edits reverse along with the fact and the field returns
to its value before it
([`generation-pipeline.md → Reverse-replay`](../generation-pipeline.md#reverse-replay)).

What stays open:

- Prose written after the user's edit can still revise the field. That
  is the authoring contract, not a gap.
- A fact whose source turn doesn't resolve keeps the window's newest
  turn as its survival anchor
  ([`classifier.md → Provenance attribution`](./classifier.md#provenance-attribution)),
  but its prose dates to the window's oldest turn. A user edit made
  after that turn then outranks it even when the real source is
  later, an error in the user's favor.
- A reversal that deletes a row the machine created, an entity or
  happening on abort or recovery or a happening on a prose edit,
  deletes the user's edits to it too, and prunes their deltas with it
  ([`generation-pipeline.md → Reverse-replay`](../generation-pipeline.md#reverse-replay)).
