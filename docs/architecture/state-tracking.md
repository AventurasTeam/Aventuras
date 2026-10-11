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
the insert itself. Three kinds of row:

- **change** — one write to one character, location, item, story beat or lorebook entry. `entity_id`
  is the row actually written, which on a lightweight branch can be an override or a tombstone.
  `before` holds the changed fields of an update, the full row of a delete, or the row a create
  shadows (a copy-on-write override shadows its parent). `after` is kept for manual changes only.
- **header** — one per narration classified while tracking is on, even when nothing changed, so
  "recorded, nothing changed" is not mistaken for "not recorded". It carries the clock and the
  current location from before the classification, and `continuous`. An entry a story starts
  from gets an empty, continuous one while tracking is on: a wizard's opening, and the last entry
  of an imported SillyTavern chat.
- **break** — no reconstruction crosses it. Only an export writes one, into the file, where it
  cannot vouch for tracking since a branch's last record.

A SillyTavern chat import replaces the whole main branch, its records included, so nothing tracked
comes before it. The world-state choice and batch chapterization that follow it change the world
without per-entry records, but before the next entry exists, so their changes belong to the last
imported entry's state and a rebuild there is exact. The imported entries before it have no
headers and stay refused.

Every writer is covered: the classifier, lore management (after a chapter, and Tidy), the
Duplicates merge, lorebook file imports, and manual add, edit and delete in the world and lorebook
panels. Each change carries its origin and is attached to an entry:

- `agent` — the classifier, on its narration, and other automatic writes such as a generated
  portrait, on the latest entry.
- `chapter` — lore management after a chapter, on the narration of the turn that created it, or on
  the last completed entry for a chapter made by hand. That is where the new lore starts to shape
  generation, so a checkpoint before it holds the lore its entries were written with.
- `tidy` — a lore management run the reader started, on the last completed entry when it started.
- `manual` — the reader's edits in the world and lorebook panels, the Duplicates merge and lorebook
  file imports, on the last completed entry.

A session overlapping a turn never lands on that turn's entries. Every change keeps its new values
in `after` except the classifier's, which no saved state can predate (see below).

Store writes commit the entity row and its record in one `database.transaction`. The classifier is
the exception: it writes through many direct calls, so it clones the in-memory state at the start and
records the difference at the end, header first, in one transaction. Translated fields are a derived
cache and are not recorded. The retry restore paths are not recorded either: they return the world to
before the turn being retried, whose narration and records are deleted with it.

Entries recorded before this table existed keep their `story_entries.world_state_delta`.
`fromWorldStateDelta` reads one as records with a header marked `coverage: 'classifier'`: the
classifier was all it recorded.

## Undoing

`planReversal` replays records newest first over a copy of a state, so for every field the earliest
recorded value is the one left standing, and a create later deleted cancels out. It returns the
resulting state and the database operations that would produce it. The reader's and Tidy's changes
can each be kept: they are applied again afterwards from their `after` values, and one whose entity
no longer exists (an automatic change in the range created it) is reported as unkeepable rather than
dropped silently.

Revert on delete runs that plan over the live state and executes it in one transaction, so it lands
whole or not at all. When it would undo the reader's or Tidy's changes, the delete confirmation
lists them, each group under its own heading, and the reader keeps them or not. Every revert the
reader did not answer — dismissing an error entry, regenerating a narration, a retry restore —
keeps them.

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
the nearest full state after P on the branch — an automatic or closing snapshot, an existing
checkpoint, or the live state — and the records between undone over it. A change may have gone
unrecorded wherever tracking could have been off: before a non-continuous header back to the last
thing written while tracking was on (any record or snapshot proves that), after a break, and after
the last record if tracking is off now or was turned on again since. A rebuild is refused when such
a stretch falls between P and its anchor, when a narration in between has no header, or when the
history in between is classifier-only. It is also refused when P itself has no header, or only an
old classifier-only one: its own state was never fully recorded. What the entries show is checked
before what is inferred from times, and old records prove nothing about tracking: they were written
whatever the reader did by hand, so a story played before full recording began reports its old
records, not a pause. Neither do snapshots on entries without a full header: the old build took
them too.

A saved state can predate changes that belong to it. Lore management and Tidy run in the background
and can finish after the snapshot of an entry they attach to at or before it, and the reader can
edit after a snapshot of the latest entry. `resolveRun` returns those as `late`; `planReversal`
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

A rebuild that goes through lists the reader's and Tidy's changes it undoes, each with its own
choice to include them, and notes how many chapters' lorebook updates it leaves out.

A refusal can be overruled under the form's Advanced fold. `resolveOverride` then builds the state
from the nearest full state after P, undoing only what was recorded, or takes the nearest full
state after or before P unchanged. Either way changes made in the gaps are wrong in it, so the form
prefills the name with "Approximate — " for the reader to keep or clear; nothing else marks it.
Such a checkpoint is never an anchor, like any other made after its entry had a successor.

Closing snapshots make an interrupted run usable afterwards: turning the feature off snapshots every
branch written to since it was turned on, before the setting changes, since lightweight branches
resolve differently once it has. A checkpoint created after its entry already had a successor was
itself rebuilt, possibly carrying manual changes back by the reader's choice, so it is never an
anchor.

Closing snapshots carry the id prefix `closing:`, which is how the landmark filter's "Show snapshots"
filter names them apart from automatic ones without a column of its own.

Story-time reconciliation rewrites a header's recorded clock as it does a delta's, and deletes the
snapshots of the entries it rewrites; a run that loses its closing snapshot that way refuses past
checkpoints rather than rebuilding them wrongly.
