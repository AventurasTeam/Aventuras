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
  current location from before the classification, and `continuous`.
- **break** — no reconstruction crosses it. Batch chapterization writes one before it classifies,
  since it changes the world without per-entry records.

Every writer is covered: the classifier, lore management (automatic and Tidy lorebook), the
Duplicates merge, lorebook file imports, and manual add, edit and delete in the world and lorebook
panels. Each change carries its origin — `agent` for the classifier and automatic lore management,
`manual` for the rest, Tidy included — and is attached to the latest entry of the branch it was made
on. A lore session attaches to the last completed entry when it started, so a session overlapping a
turn never lands on that turn's entries.

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
resulting state and the database operations that would produce it. With `keepManual`, manual changes
are applied again afterwards from their `after` values; one whose entity no longer exists (an
automatic change in the range created it) is reported as unkeepable rather than dropped silently.

Revert on delete runs that plan over the live state and executes it in one transaction, so it lands
whole or not at all. When it would undo manual changes, the delete confirmation lists them and the
reader chooses to keep them or not. Every revert the reader did not answer — dismissing an error
entry, regenerating a narration, a retry restore — keeps them.

## Tracked runs

A header's `continuous` says tracking ran without interruption since the previous header on the
same branch line: the branch's own entries, then its parent's up to the fork. It needs only
`experimentalFeatures.trackingEnabledSince`, set when the feature is turned on: a previous header
written before it cannot vouch. A sequence of continuous headers is a tracked run; no table stores
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
history in between is classifier-only.

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
