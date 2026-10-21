# State Tracking

The Labs feature that records every change to a story's world and lorebook, so a revert can undo
them and a checkpoint can be rebuilt at a past entry. Code: `services/stateTracking/` (pure, tested
without the store), `rollbackService.ts`, and the write methods of `stores/story.svelte.ts`.

## Nothing while it is off

With State Tracking off nothing is recorded and no story gains a row, a column value or a flag. The
recorder has one gate, `recordContext`, and every write goes through it. Turning the feature off
writes the closing snapshots described below and nothing else.

## What is recorded

`world_state_changes` (migration 040) is append-only. `seq` is the story's write order, assigned in
the insert itself. Four kinds of row:

- **change** — one write to one character, location, item, story beat or lorebook entry. `entity_id`
  is the row actually written, which on a lightweight branch can be an override or a tombstone.
  `before` holds the changed fields of an update, the full row of a delete, or the row a create
  shadows (a copy-on-write override shadows its parent). `after` holds the new values, except on
  the classifier's records.
- **header** — one per narration classified while tracking is on, even when nothing changed, so
  "recorded, nothing changed" is not mistaken for "not recorded". It carries `continuous`. An entry
  a story starts from gets an empty, continuous one while tracking is on: a wizard's opening, and
  the last entry of an imported SillyTavern chat. The scene needs no field of its own: moving it
  changes the `current` flags of location rows, which the classifier records like any field.
- **break** — no reconstruction crosses it. An export writes one into the file where it cannot
  vouch for tracking since a branch's last record.
- **mark** — where a snapshot, a checkpoint of the live state or a chapter was made, written in the
  transaction that makes it, whether tracking is on or not; `entity_type` and `entity_id` name it
  (migration 041). A snapshot or checkpoint holds every record before its mark, and a chapter's
  lore sessions are recorded after its own, so whatever reads the order compares `seq`, never
  creation times. A mark lives as long as what it marks: each delete of a snapshot, checkpoint or
  chapter takes its mark in the same statement batch, and deleting an entry or a branch takes it
  with their records. One left behind is never read, since it is looked up from its owner. A
  checkpoint rebuilt from the records gets none. The record queries leave marks out
  (`getWorldStateMarks` reads them), so nothing that counts or lists records sees them.

A SillyTavern chat import replaces the whole main branch, its records included, so nothing tracked
comes before it. The world-state choice and batch chapterization that follow it change the world
without per-entry records, but before the next entry exists, so their changes belong to the last
imported entry's state and a rebuild there is exact. The imported entries before it have no
headers and stay refused.

Every writer is covered: the classifier, lore management (after a chapter, and Tidy), the
Duplicates merge, lorebook file imports, and manual add, edit and delete in the world and lorebook
panels. Each change carries its origin and is attached to an entry:

- `classifier` — the classifier, on its narration.
- `image` — the story-image generator's writes to a character, on the last completed entry. The
  generator runs during a turn and on demand from any narration, without the classifier.
- `chapter` — lore management after a chapter, automatic, by hand or batch, on the chapter's last
  entry. A chapter exists from that entry on everywhere — a revert removes it with its entries, a
  branch inherits it when it ends before the fork — so its lore comes and goes with it. The session
  still reads a tail past the chapter, so a checkpoint between the chapter's end and the tail's holds
  lore that has read a little ahead.
- `tidy` — a lore management run the reader started, on the last completed entry when it started.
- `manual` — the reader's edits in the world and lorebook panels, the Duplicates merge and lorebook
  file imports, on the last completed entry.

A session overlapping a turn never lands on that turn's entries. Every change keeps its new values
in `after` except the classifier's, which no saved state can predate (see below).

A store write commits its rows, any copy-on-write override it needs, and their records in one
`database.transaction`, and publishes to memory once that commits. The classifier is the
exception: it writes through many direct calls, so it clones the in-memory state at the start and
records the difference at the end, header first, in one transaction. Its diff leaves the lorebook
out: it never writes there, and a lore write landing while it runs is not its change. Translated
fields are a derived cache and are not recorded, and neither is a character's `portrait`: image
data would ride into every export, sync and load of the records, so a revert leaves portraits as
they are. A regenerate writes no records of its own: it rewinds through them.

Entries recorded before this table existed carried a per-entry `world_state_delta`. Migration 041
moved each into the table and dropped the column, and import does the same for an older story file
through `fromWorldStateDelta` (`legacy.ts`); one fixture beside it is asserted against both. A
converted header has origin `legacy`, which a header otherwise leaves empty and `rowToRecord` reads
as `coverage: 'classifier'`: the classifier was all it recorded. The scene the entry left, kept
apart in the old form as `currentLocationId`, becomes the update the classifier writes now: that
location regaining `current`. An entry that already had a header of its own was skipped. The
migration also stripped the deltas from every checkpoint's copy of the entries. A file whose
entries carry deltas next to change records came only from a development build, and import
refuses it.

The same migration gave every existing snapshot, checkpoint and chapter its mark and renumbered
each story's rows from 1 in that order. Among converted rows a mark goes after those of entries up
to its own: an old snapshot or checkpoint was taken with its entry the latest classified, and a
converted row's time is its entry's, which a sync or import resets. Among rows written since, it
goes after the last one written by the time it was made. Import places marks the same way for a
file without any; a file that carries them keeps its order.

## Undoing

`planReversal` replays records newest first over a copy of a state, so for every field the earliest
recorded value is the one left standing, and a create later deleted cancels out. It returns the
resulting state and the database operations that would produce it. The reader's and Tidy's changes
can each be kept (`RevertKeep`): they are applied again afterwards from their `after` values, and one whose entity
no longer exists (an automatic change in the range created it) is reported as unkeepable rather than
dropped silently. A tombstoned row comes back by clearing its tombstone, and a row written again from
a record takes the columns no record holds (a portrait, the translations) from the row as it was,
so a revert never strips them. A revert that removes entries records the kept changes again on the entry that now ends the branch, in the same transaction: their own records go with the removed entries, and a later revert must still be able to undo and list them. They are recorded as the plan applied them, in that order, with each `before` read from the state it landed on, and with the revert's time, since they are new writes.

The clock is not recorded at all. After a revert, and in a past checkpoint, it is the end time of
the last entry that remains (`clockAfter`): a gap before the removed entries goes with them, and
no full state's or header's clock is ever restored. An entry without a time is looked past; with
none before, the clock is cleared.

Revert on delete runs that plan over the live state and executes it in one transaction, so it lands
whole or not at all. The delete is confirmed in a modal, like a checkpoint or a branch. When it
would undo the reader's or Tidy's changes, it lists each group under its own heading, and undoes
them too (`KEEP_NONE`). There is no choice to keep them: a record holds whole field values, so
keeping an edit made over a reverted change would keep that change's text with it. Keeping only
the edits whose base survives is planned separately. Its description names the range a delete removes, and a
switch deletes only that entry without a rollback, as with the feature off. `revertLines` adds a
line each for what is undone besides the listed changes: the classifier's changes when the range
holds any (`ReversalPlan.classifier`), then the lore management of each chapter, named by the
`chapter` records in range, each owned by the chapter ending on its entry when written after that
chapter's mark and otherwise by a chapter since deleted there (`loreOwners`). They stack, with the chapters the removal deletes and, from
`deletedSnapshotsLine`, the world-state snapshots that go with the removed entries; the
past-checkpoint form shows the revert lines.

Deleting an entry without a rollback (the switch, Revert on Delete off, an error entry dismissed)
leaves its changes live, so its changes and breaks move to a neighbouring entry in the same
transaction (`recordsHolder`). Its header goes with it unless it marks a gap (not continuous): that
is the only record of the gap, and moves too. A narration's move to the entry after
it: they were made after the entry before, whose state still leaves them out, and a revert from the
entry after lists and undoes them. A user action's move to the entry before it: they were made
before the narration answering it, so regenerating that narration must keep them. Either takes the
other side when there is no entry on its own.

A regenerate removes entries, so it rewinds as a delete does, through the records whenever State
Tracking is on, whatever Revert on Delete says: `rewindForRetry` for a retry with a backup,
`undoNarrationForRegenerate` without one. A revert that fails stops the regenerate before any entry
is removed. When the range holds chapter, manual or Tidy records, or a chapter goes with it, the
deletion modal asks first, titled for the regenerate, and the reader's and Tidy's changes are
undone as in a delete; otherwise it does not ask. Dismissing an error entry and stopping a
generation keep the reader's and Tidy's changes without asking (`KEEP_ALL`): neither is a revert
the reader chose.

Deleting a chapter can take its lore with it (`DeleteChapterModal`, on by default).
`planChapterLoreRevert` (`chapterLore.ts`) takes the `chapter` records on its last entry written
after its mark, leaving those of a chapter deleted earlier on the same entry, and every later record
on the same lorebook entries, an override's included, and undoes them all, the
reader's and Tidy's later changes included, which the modal lists by origin. It acts on the live
lorebook, so the records it undoes are invalidated, not answered with records of the undo: they are
deleted, in the transaction that deletes the chapter, and so are the snapshots on the open line's
entries marked after the first of them, which hold their effect (`marksHolding`; the confirmation
lists them). The checkpoints marked after it hold that effect too: they stay, since the reader made
them, but lose their marks, so no past checkpoint is rebuilt from them. A later revert or chapter
delete never lists the undone records again, and a past state is rebuilt from a later full state,
the live one at worst. A past checkpoint only reads records, and invalidates nothing. The undo is
refused unless everything since was recorded (tracking on since before the chapter's records, and
no break or non-continuous header after them), since an unrecorded edit would be overwritten; that
also means no closing snapshot lies in the span it deletes. A chapter the open branch inherits
cannot be deleted from it at all (`ownsChapter`): its row belongs to the branch it was cut on, and the
records reached through the line would revert that branch's lorebook instead of this one's.

## Tracked runs

A header's `continuous` says tracking ran without interruption since the previous header on the
same branch line: the branch's own entries, then its parent's up to the fork. It needs only
`experimentalFeatures.trackingEnabledSince`, set when the feature is turned on: a previous header
written before it cannot vouch. With no previous header, the story's creation stands in for one,
so the first narration of a story created while tracking was on starts a run. A sequence of continuous headers is a tracked run; no table stores
runs, so they travel with the story.

Moving a story between devices cannot carry the other device's toggles, so an export appends a
break to every branch whose run this device cannot vouch for since its last record.

## Checkpoints at past entries

The state at entry P is the state just before the next entry was created. `resolveRun` finds it from
the nearest full state after P on the branch — an automatic or closing snapshot, a checkpoint
anywhere on the branch line (the fork's included), or the live state — and the records between
undone over it: those on entries after P written before the anchor's mark. A change may have gone unrecorded wherever tracking could have been off: before a
non-continuous header back to the last thing written while tracking was on (any record or snapshot
proves that), after a break, and after the last record if tracking is off now or was turned on
again since. A rebuild is refused when such a stretch falls between P and its anchor, when a
narration in between has no header, or when the history in between is classifier-only. It is also
refused when P itself has no header, or only an old classifier-only one: its own state was never
fully recorded. What the entries show is checked before what is inferred from times, and old records
prove nothing about tracking: they were written whatever the reader did by hand, so a story played
before full recording began reports its old records, not a pause. Neither do automatic snapshots
on entries without a full header: the old build took them too. A closing snapshot always proves it,
wherever it sits: only this build takes one.

A saved state can predate changes that belong to it. Lore management and Tidy run in the background
and can finish after the snapshot of an entry they attach to at or before it, and the reader can
edit after a snapshot of the latest entry. `resolveRun` returns those, the changes at or before P
written after the anchor's mark, as `late`; `planReversal`
applies them onto the saved state from their `after` values, in write order, before undoing. A
snapshot therefore never stops being usable for its own entry, and nothing is skipped or rewritten
for it. The classifier's changes need no `after`: a snapshot is taken after its own classification,
and every later classification belongs to a later entry.

A refusal carries a `RunDiagnosis` the form lists under the warning: whether P has a full header,
the nearest full state after P (or the one that passed), and everything breaking the tracked
sequence between them, in story order, so a reader about to overrule it sees the whole of it.
Consecutive narrations that are unrecorded, or recorded only in the old classifier-only form, are
one stretch; a non-continuous header, a break or a re-enable after the last record follows, located
by entry numbers. A pause with no entry to place it at is left out when the entries already show
the gap.

A rebuild that goes through lists the reader's and Tidy's changes made after the entry, which the
checkpoint leaves out, and notes how many chapters' lorebook updates it leaves out.

A refusal can be overruled under the form's Advanced fold. `resolveOverride` then builds the state
from the nearest full state after P, undoing only what was recorded, or takes the nearest full
state after or before P unchanged. Either way changes made in the gaps are wrong in it, so the form
prefills the name with "Approximate — " for the reader to keep or clear; nothing else marks it.
Such a checkpoint is never an anchor, like any other made after its entry had a successor.

Export and import do not carry automatic or closing snapshots. An imported story's full states are
its checkpoints and its live state until new snapshots are taken, so its rebuilds anchor farther
from P. This is a known limitation.

Closing snapshots make an interrupted run usable afterwards: turning the feature off snapshots every
branch written to since it was turned on, before the setting changes, since lightweight branches
resolve differently once it has. Resetting the experimental features takes them the same way. When
they fail, the reader is asked whether to turn tracking off anyway: they can only be taken while it
is still on. A checkpoint created after its entry already had a successor was
itself rebuilt, possibly carrying manual changes back by the reader's choice, so it is never an
anchor.

Closing snapshots carry the id prefix `closing:`, which is how the landmark filter's "Show snapshots"
filter names them apart from automatic ones without a column of its own.

Story-time reconciliation keeps the snapshots of the entries it rewrites and gives each its
entry's new ending, as it does a checkpoint. A past state takes its clock from the entries, never
from the anchor, so the copy only stays honest. Records hold no clock, so it has none of theirs to
rewrite.

A snapshot saved without the lorebook, by an older build, is no candidate: the next full state is
used, and the checkpoint form names each such snapshot it passed over.
