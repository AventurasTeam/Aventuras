# Reversal integrity — link rows and delete payloads

Resolves the `4.2c planning gate — Reversals leave link rows and delete
payloads out of step with the log` entry in
[`followups.md → Data-model`](../followups.md#data-model). The commit
that lands this record replaces that entry with a one-line
implementation entry: the design is settled, the code is not.

The substrate is the reverse-replay contract in
[`generation-pipeline.md → Reverse-replay`](../generation-pipeline.md#reverse-replay)
and the log rules in
[`data-model.md → Entry mutability & rollback`](../data-model.md#entry-mutability--rollback).

## What this closes vs. defers

Closes:

- **Dangling links.** A reversal that removes a row now removes every
  row naming it, on every reversal path, CTRL-Z included.
- **Rows coming back with no history.** A reversal that reaches a row
  held only in a delete's `undo_payload` applies to that copy, so
  undoing the delete can no longer restore a reversed write.
- The two calls the 2026-10-04 triage pass left inside the entry:
  CTRL-Z runs the closure and redo restores what it removed; a
  reversal reaching a deleted row prunes the delete, and refuses when
  the delete's group would write the row's id back.

Defers:

- **Implementation**, to a standalone PR that lands before 4.2c's
  merge, tracked in `followups.md`.
- **Ids inside entity `state` and entry metadata.** Out of scope, for
  the reasons in [Scope](#scope).

## Ground truth

Probed with scratch vitest files (not committed) against the `main`
head after #567, through the real actions: `applyDeltaAction`,
`deleteEntityRow`, `deleteRow`, `updateStoryEntryContent`,
`undoLastAction`, `redoLastAction` and `reverseReplayDeltas`.

| Probe | Trigger                                                                                      | Result                                                                          |
| ----- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| P1    | CTRL-Z of a user-created character after a pass linked her                                   | Involvement, awareness and relationship stay, naming her; redo makes them valid |
| P2    | Abort of a pass that created a character the user linked mid-burst                           | The user's relationship stays naming a character that exists nowhere            |
| P3    | Captured relationship, both ends live: abort, then CTRL-Z the delete                         | The relationship is live with no delta                                          |
| P4    | P3 through a happening delete (awareness)                                                    | Same                                                                            |
| P5    | The deleted row itself, a happening and a character: abort, then CTRL-Z both deletes         | Both live with no delta                                                         |
| P6    | A pass changed a captured relationship from `ally` to `rival`: abort, then CTRL-Z the delete | Back as `rival`; the log holds only the user's `ally` create                    |
| S1    | Prose-edit sweep: delete a character and a happening, edit the head turn, CTRL-Z all three   | Relationship, awareness and happening all live with no delta                    |

P4 and S1 create the happening in an earlier pass than the awareness
under it, which the classifier does not do: it links only happenings it
creates in the same pass
([`parked.md → A dirty links array on Save overwrites concurrent link writes`](../parked.md#a-dirty-links-array-on-save-overwrites-concurrent-link-writes)).
S1's shape still arises inside one pass, since a happening can anchor
to an older turn than awareness of it
([`classifier.md → Provenance attribution`](../memory/classifier.md#provenance-attribution));
the 4.2b probe reproduced it that way. P4 is the general rule only.

Which paths ran a closure: `reverseReplayDeltas` (abort, boot
recovery, a turn refused at admission) and
`resolveClassifierFactDeltas` (the prose-edit sweep). CTRL-Z of a
group reversed through `reverseAndPruneDeltaRows` alone; CTRL-Z of a
turn, regenerate and rollback select by `resolveSweep`'s window, with
no closure. Where a closure ran, it followed only a happening's
involvement and awareness rows (`CHILD_TABLES`).

## The finding

The planner knows a row's lifetime only through the deltas on that
row. Rows are connected two other ways it did not follow:

- **References.** A link row names an entity or a happening. The
  columns are already listed once, in `live-refs.ts`, for the
  live-link filter and the forward guard `missingRef`.
- **Delete payloads.** A deleted row is not gone. It lives in its
  delete's `undo_payload`, as the target or a captured child, until
  that delete is undone. The planner read "absent from its table" as
  "absent".

So the first gap is _removing a row must remove what references it_,
and the second is _an undo must apply to the row wherever it lives_.
P3 to P6 and S1 are all one failure: an undo reaches a row held only
in a payload, touches nothing, is pruned, and the payload keeps the
stale copy. The deleted-row case is both at once.

## Decisions

### Target: strict

After every reversal, two rules hold:

1. **No dangling reference.** No row names a row that exists nowhere,
   where a row exists in its table or held in a delete's payload.
2. **Nothing reversed comes back.** A reversed delta's effect survives
   nowhere, in the table or in a payload. Nothing returns without a
   delta that can remove it again.

Rejected: fixing dangling references and only the rows returning with
no history, accepting stale values like P6, which leaves a log that
cannot explain what a delete's undo restores; and tolerating dangling
references at read sites, which costs every present and future read
site and leaves P2 unrepaired.

### A write-phase lock, not a single transaction

The periodic pass makes one model call, but commits each planned
action as its own `applyDeltaAction` transaction, and its watermark
write follows separately. The developer's point holds for P2 and the
`state`-reference case: a human cannot see a row the pass just created
and act on it within the burst's milliseconds. It does not hold for
the abort trigger of the second gap, which needs no perception: a
delete of a row that predates the pass can commit between two writes
by timing alone, and a later failure in the same run then reverses
around it.

A lock the developer proposed closes all of it. First considered was
committing the pass as one `applyDeltaActionGroup`, rejected for its
cost: group handlers read pre-group state, so the planner would have
to merge same-row writes, and the group runner would need per-action
noop skipping.

### Captured rows follow live rows

Undoing a prose edit does not restore the facts it swept. It clamps
the classifier watermark and the next pass re-derives them. CTRL-Z is
newest-first, so a delete older than a prose edit can be undone only
after that edit is, when the prose its captured rows came from is
back.

Chosen: the sweep applies to a captured row as it does to a live one,
and the facts come back by re-derivation as new, tracked rows. Its
costs, accepted:

- A pruned delete leaves undo history.
- A happening the user deleted comes back re-derived, as any
  user-deleted fact does after an edit and its undo.
- **Link loss in rare timing.** A pass that runs between undoing the
  edit and undoing the delete cannot re-derive links naming the
  still-deleted row: the write is a `noop` on a missing ref. That
  needs a completed turn between the two undos (which the user then
  undoes too), a pending retry timer, or a manual run. Only
  classifier-derived links are lost; a relationship view the user
  wrote keeps its row by the `rowKeepingColumns` rule. Editing that
  turn again re-derives them.

Rejected: leaving captured rows untouched. The pass re-deriving after
the edit's undo removes nothing first, since the captured happening
escaped that undo's reversal, so every restored happening duplicates.
It also breaks on rollback: a content edit's delta is anchored to its
own turn and survives a rollback to it, while the rollback restores
the deletes after it, so captured facts from the replaced prose come
back beside the new prose, and the watermark clamp stops short of
re-deriving that turn.

Rejected: a hybrid keeping links (upserts cannot duplicate) and
stripping happenings. The rollback case defeats it the same way.

### One closure, every path; redo restores its rows

The closure belongs to the one step that selects a reversal set, so a
path cannot forget it, which is how CTRL-Z, regenerate and rollback
came to skip it. Redo restores the rows it removed, keeping undo and
redo exact inverses and today's visible behaviour, where P1's links
work again after a redo.

Rejected: a closure call per caller; redo restoring the group alone,
which loses the links on every undo and redo of a create since a
non-content undo clamps nothing; and redo clamping the watermark to
re-derive them, a whole-window pass to rebuild rows the snapshot holds.

### Implementation lands first, on its own

A standalone PR before 4.2c. It is substrate work, independent of
4.2c's UI, and 4.2c's merge depends on the contract. Rejected: folding
it into 4.2c, and a new M4 slice for the same outcome.

## Design

### Scope

Every reversal path: CTRL-Z of a group or a turn and their sweeps,
redo's invalidation, regenerate, rollback, a branch fork's
reverse-apply, abort, boot recovery, a turn refused at admission, and
the prose-edit sweep.

References: the three link tables, and translations by `target_kind`.
Translations are delta-tracked (`createTranslation`) but nothing writes
them yet.

Out of scope:

- **Ids inside entity `state`** (`current_location_id`, `faction_id`,
  `inventory`, `equipped_items`, `parent_location_id`,
  `at_location_id`). Only the per-turn piggyback and user edits write
  them. The lock closes their one reversal path, a user edit inside a
  burst; everything else is newest-first ordered, and sweeps never
  reverse an entity create (`isReversible`).
- **Scene ids in entry metadata.** A dead id in an older entry is
  already permanent by canon
  ([`entry-card.md → Emitted vs. applied`](../ui/patterns/entry-card.md#emitted-vs-applied));
  the tail's follows the `state` reasoning.
- **The story lead.** Deleting it is refused; M6 reworks it.

### Where the spec lives

The lock is specified in
[`generation-pipeline.md → No-gate write phase`](../generation-pipeline.md#no-gate-write-phase);
the closure, the reversal of rows a delete holds, both refusals and
the redo labels in
[`generation-pipeline.md → Reverse-replay`](../generation-pipeline.md#reverse-replay);
the log, CTRL-Z, redo and survival-anchor consequences in
[`data-model.md → Entry mutability & rollback`](../data-model.md#entry-mutability--rollback).
Integration added one path to the list: a branch fork's reverse-apply,
which reverses a suffix like rollback does; fork itself is not built
yet.

## Adversarial pass

- **Load-bearing assumption.** Newest-first undo plus the lock confine
  payload edits to sweeps, and keep captured rows out of redo
  snapshots and entity targets out of reach. Where that fails, the
  planner refuses rather than corrupts.
- **Chapter-close.** The first refusal draft covered entity deletes
  only, assuming every other delete is alone in its group.
  [`chapter-close.md → 3e`](../memory/chapter-close.md#3e--happenings-consolidation)
  breaks that once built; the group-scoped write-back check replaced
  it. A consolidated description can still carry facts from prose
  later replaced; that is content, not log integrity, and no ledger
  tracks it.
- **Live-link filter.** With stripping, no payload holds a row naming
  a removed one; the filter stays as a backstop for payloads written
  before the change. No migration: the app has not shipped, and dev
  databases reseed (assumed).
- **4.2c History.** A payload edit emits no store patch, so History
  reading link rows from payloads cannot rely on store patches to
  refresh after a reversal edits one. An input to 02c's refresh
  question.

Verified: every probe above; the write loop and the orchestrator's
dispatch; the scheduler's triggers; that every delta-logged write
clears the redo stack; the metadata lock's users; that translations
are delta-tracked. Assumed: the burst does no slow work; the closure's
query cost; the classifier does not dedupe happenings; no user data
needs migrating; the 400–600 line estimate for the implementation.

## Integration plan

- `generation-pipeline.md → Concurrency model`: the `no-gate` bullet,
  and a new `### No-gate write phase` subsection.
- `generation-pipeline.md → Reverse-replay`: the closure paragraphs
  rewritten for the registry, every path, the labels, the
  survival-anchor exception and the `rowKeepingColumns` override; a
  new paragraph on a reversal reaching a deleted row, with both
  refusals.
- `data-model.md → Entry mutability & rollback`: payload edits under
  "a reversal takes its deltas with it"; CTRL-Z step 2's exception;
  redo restoring the closure's rows; the survival-anchor exception.
- `memory/cadence.md → User edits and classifier writes` and the
  `gateBehavior` row in `memory/classifier.md`: edits wait out the
  write phase.
- `ui/screens/reader-composer/rollback-confirm/rollback-confirm.md`:
  the world-state count covers the closed set.
- `02c-collision-review.md → Open questions`: the merge question's
  link text names the implementation entry and the canon.
- `followups.md`: the entry is replaced by the implementation entry,
  so `#data-model` keeps its one inbound link.

No heading renames, no pattern adoptions, no wireframes.
