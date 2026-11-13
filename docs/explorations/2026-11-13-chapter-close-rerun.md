# Re-running a chapter's close

How the user runs a chapter's close again when its output is poor, and
trades a worse second run back for the first. Designed 2026-11-13;
resolves the UX followup "Re-run a chapter's close" and the
Timeline's open question on re-running lore management, and adds
Slice 5.13 to M5.

## Why

The review window shows what a close changed and offers nothing when
the result is poor overall. The nearest path, deleting the chapter
and closing it again by hand, can't be undone, so a worse second
close can't be traded back for the first, and the next Send may close
the reopened turns first, at an end it picks.

## Ground truth that shaped it

- **Every reversal prunes the deltas it replays**
  ([`data-model.md → Entry mutability & rollback`](../data-model.md#entry-mutability--rollback)),
  and redo lives in memory, cleared by any logged write. That is why
  Delete can't be undone, and why "reverse the first close, then run a
  fresh one" can't hold the first for CTRL-Z: its deltas are gone.
- **The reversal plan already separates row writes from log prunes.**
  `buildReverseAndPrunePlan` (`lib/actions/delta/reverse-replay.ts`)
  returns the row ops, the prunes and the row patches apart, for a
  caller committing them in its own transaction.
- **The report is an `updateChapter` delta** in the close's own group,
  source `chapter_close`, anchored on the end entry
  (`lib/pipeline/definitions/chapter-close-report.ts`), and it records
  its group's `actionId` (C4).
- **A plain reversal edits the log outside its set in three cases**: a
  held delete's payload copy, a create re-owned to a user write that
  keeps the row, and a relationship's stranded writes. The last two
  arise only on relationship rows, which no close tool writes.
- **`Regenerate summary` is M7.2**, disabled until then.

## Decisions

- **Undoable, durably.** CTRL-Z after a re-run restores the first close,
  across restarts, while the re-run is the latest action, and a failed,
  cancelled or crashed re-run leaves the first close standing. Durable
  means surviving a restart, not reachable at any later time: after a
  turn or an edit, CTRL-Z reaches the re-run only through them. Rejected: deleting the first close and holding
  it in memory, which a restart or a crash loses; and a re-run with no
  undo, which only fixes the "next Send picks the end" half.
- **Lore work only.** A re-run reverses and re-runs phases 3 and 4 and
  the in-code steps. The chapter row, its number, end, stamps, title
  and summary stay; metadata stays `Regenerate summary`'s. Rejected:
  re-running metadata too, which must decide what happens to a title
  the user edited and overlaps M7.2; and a re-close with a new end,
  which moves stamps and the open region.
- **The current model.** The `lore-mgmt` assignment or the story's
  override, as a close. Trying a stronger model means changing the
  assignment first. Rejected: a per-run profile pick in the confirm, a
  new model-selection surface.
- **Latest chapter only**, as Delete: later closes build on an earlier
  one's merges.
- **Its own slice, 5.13,** after 5.10, 5.11 and 5.12.

## The logged reversal

**What it reverses: the chapter's lore work.** Every delta in the
chapter's close groups except those on `chapters` and `story_entries`
(its row, report and stamps), the complement of
`Remove divider only`'s seed. A chapter's close groups are the
`chapter_close` groups that wrote its row: the first close's holds the
create, and each re-run's a report update. No new column.

**How.** The same set and plan as a delete (`selectReversalSet` with
`yieldTo: 'any'`, then `buildReverseAndPrunePlan`), but nothing is
pruned. Each row change is logged as a forward delta under the
re-run's `action_id`, its undo payload read from the row before the
change: a removed row is a `delete` with the whole row, a returned row
a `create`, a changed field an `update` with the old value. The first
close's deltas stay in the log.

**It edits no delta outside itself.** Of the plain reversal's three
log edits, re-owning and stranded-write prunes arise only on
relationship rows. The third is reachable: a row the close wrote that
a later write deleted stays deleted, and that delete's undo restores it
as the close left it, the case canon already accepts for Delete ("a
later undo can bring a deleted value back"). A row the reversal itself
deletes is held by its `delete` delta, so writes left in the log to
that row, such as a user's edit of a close-created lore row, are held
writes, as after a user's own delete.

**What follows.**

- CTRL-Z of a re-run is an ordinary group undo: the re-run's writes,
  then the reversal's, newest first, restoring the first close's state
  and, through the report update, its report.
- A failed, cancelled or crash-recovered re-run reverses its group the
  same way.
- Delete and `Remove divider only` seed from all the chapter's close
  groups. Over the union the replay nets out: re-run, reversal, first
  close.
- A rollback into the chapter takes all of it, every delta anchoring on
  the end entry.
- Later writes win, as for Delete: the reversal yields on any field
  written after the first close, except a `retrieval_count` bump.
- C12 is unchanged: the reversal's deltas are `chapter_close`, so the
  re-run's tasks don't read them as a later turn's.
- **Counts are net.** A union replays deltas that cancel (a create and
  the reversal's delete of it), so a confirm counts what the plan
  changes in the world, not the deltas it replays. Delete's confirm
  after a re-run needs the same.

## The run

The close pipeline in a re-run mode, on the latest chapter, its input
the chapter id:

1. **Catch-up passes while any entry through the chapter's end is
   unprocessed.** That arises after an edit of the chapter's last turn
   while it's the head clamps the watermark. A chained successor takes
   no inputs, so `TxState` gains `pendingRerun: { chapterId }` beside
   `pendingClose`; a restart drops it. While it's set, a pass's
   `chainsTo` returns a pass until those entries are processed, then
   the re-run, and never an owed close: that waits for Send, as today.
   The re-run chains nothing.
2. **The logged reversal,** one write.
3. **Run order steps 4 to 9:** normalization, Happenings, the part
   tasks, Awareness, the reset, the report and display translation.
   Parts are cut fresh for the current model's window; Awareness reads
   the existing summary.
4. **The report is an update of the chapter row** carrying the re-run's
   `actionId` and `reversedThrough`, the log position of the
   reversal's last delta.

No boundary selection, metadata or stamps.

**Starting.** Refused as the manual close's start is: a held branch, a
pending swap, a busy story. Inside the bracket it rechecks that the
chapter is the latest and has a close group, refusing `not-latest` or
`no-close`. A pre-flight failure shows a toast.

**While it runs** it holds the user-edit gate; the banner shows a
close's progress and Send waits.

**Ending.** Nothing is ever owed, since the first close stands:

| Outcome            | Result                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| Commit             | `Chapter 5's close re-ran`, with `Review`; the warning variant when tasks stopped early                      |
| Cancel / interrupt | The group reverses; `Re-run cancelled. Chapter 5's close is as it was.` The run declares no deferral slot.   |
| A failed call      | The group reverses; warning `Re-run failed. Chapter 5's close is as it was.` with the reason, and no `Retry` |
| Crash              | Boot recovery reverses the group from the log; nothing re-runs                                               |

**Head reversals.** Canon lets regenerate interrupt a running close with
no confirm because nothing of it has committed. Under a re-run the
first close has. A head reversal that reaches the re-run's chapter
confirms as it would with no run in flight, its counts leaving the run
out and counting the first close, since the interrupt restores it.
**CTRL-Z during a re-run cancels the run and undoes nothing else**: the
run is the latest action, and its cancel is its undo. Shipped
`undoLastAction` (`lib/actions/story-entries/undo.ts:80`) passes a
running run only when its target is a turn: with no later turn it
refuses a CTRL-Z during a re-run, and with one it interrupts the re-run
and undoes that later turn, which has nothing to do with the re-run.

## The UX

**Entry points,** on the latest chapter, only when a close wrote it,
disabled while a run is in flight:

- `Re-run close…` on the Timeline card, between `Review changes` and
  `Delete…`, five actions on the latest card. On phone it joins the
  `⋯` overflow.
- `Re-run…` in the review window's footer beside `Done`, where "poor
  overall" is judged. The confirm stacks over the window, as
  [`layout.md → Stacking`](../ui/foundations/mobile/layout.md#stacking)
  allows a confirm started inside a surface; `Cancel` returns to the
  review, and confirming closes it.

**The confirm**, an AlertDialog:

```
┌──── Re-run chapter 5's close? ───────────────────┐
│                                                  │
│  This reverses what the close did to the world   │
│  and runs it again on <model>. The chapter, its  │
│  title and summary stay.                         │
│                                                  │
│  • 2 lore rows removed, your edits included      │
│  • 31 other changes reversed                     │
│  • 14 turns since stay as written. What they     │
│    changed stays, and the re-run leaves it alone │
│                                                  │
│  A close is the costliest call the app makes:    │
│  this one reads 24,310 tokens of story.          │
│                                                  │
│  CTRL-Z brings this close back until your next   │
│  turn or edit.                                   │
│                                                  │
│               [ Cancel ]  [ Re-run close ]       │
└──────────────────────────────────────────────────┘
```

Net counts as Delete's two lines; the third omitted with no later
turn, and the count lines replaced by `The close changed nothing in the
world.` when the plan is empty. Token count and model name, no money
estimate. Primary, not destructive: CTRL-Z reverses it. Delete's rules
hold: counts recount while open and refuse `counts-changed`; a close
landing under it refuses `not-latest` with a toast.

**The review after a re-run** shows its report against the chapter
before any close, as a close's review does: it reads the group's deltas
above `reversedThrough`, so the reversal half stays out. No re-run
banner. The window closes when its report changes, on the re-run's
commit and on its CTRL-Z.

## Adversarial pass

**Load-bearing assumption.** The logged reversal leaves the world as
the plain reversal would, and its undo restores the first close
exactly. The undo half holds because CTRL-Z reaches the re-run only
when no user action sits above it. Verified against canon's undo walk;
the forward-delta construction from row patches plus a prior read, as
the redo snapshot reads, is assumed, not prototyped.

**Changed the design:**

- **CTRL-Z mid-run had no re-run rule.** Shipped, it is refused with no
  later turn and undoes an unrelated later turn with one. Now it
  cancels the re-run only. (First reasoned as "cancels, then undoes the
  first close", which the code read corrected.)
- **Phase 0 could chain into an owed close.** A pass's `chainsTo` starts
  the owed close once entries are processed, so with auto-close on and
  the open region at the threshold, the re-run's catch-up pass would
  close the open region instead. `pendingRerun` takes precedence and the
  re-run chains nothing.
- **The review couldn't tell the reversal from the re-run's own
  writes** inside one group, and a `create` has no payload to mark. The
  report's `reversedThrough` splits them; redo restores log positions,
  so it holds through CTRL-Z and redo.

**Accepted:**

- Trading back works only while the re-run is the latest action, and
  the first run's review goes once the re-run lands; comparing takes an
  undo, a look and a redo. Raised after the design by a side review;
  the copy now says so, and a previous-run view and a later
  `Restore previous run` are parked.
- The rollback confirm's world-changes line counts the deltas it
  replays, so after a re-run it counts the reversal's too, deltas that
  cancel. It already counts replayed deltas, not net changes; only the
  delete and re-run confirms count net.

- CTRL-Z of a re-run with a pass logged above it, only possible through
  a pass's `Retry`, writes the first close's values over that pass's,
  as CTRL-Z of any close does today.
- A row's History shows the reversal's writes as `chapter close` rows,
  three for a field both runs wrote. True, if noisy.
- The log keeps the first close's deltas plus the reversal, about two
  groups' worth per re-run.
- A later write's own undo can restore a value the reversal removed,
  as after a Delete: its payload holds the value it replaced, which may
  be the first close's.

**Checked by reasoning:**

- A re-close after `Remove divider only` at the same end: the new
  chapter's close groups hold only its own close, so a re-run leaves
  the kept work, consistent with canon.
- A re-run's own catch-up passes anchor inside the chapter: the
  reversal yields to them, and the re-run's tasks may overwrite them,
  since C12 counts only writes past the end entry.
- Several re-runs: each reverses the union, so the counts stay net, and
  CTRL-Z steps back one run at a time.

**Unverified, for 5.13's planning:**

- Whether display translations are logged in the close's group; the
  reversal does whatever Delete does with them.
- The held-row arms (`undoHeldCreate`, `undoHeldUpdate`) under rows the
  reversal holds: they exist, their behaviour here is unread.
- The reversal's write burst on Android. Slice 5.2's 132-stamp burst
  stalled the JS thread about 1.1 s; the reversal skips stamps but logs
  a delta per row change. 5.13 measures it on a full group.

## Parked

- **Comparing runs, and trading one back later.** Cheap on this design:
  the first run's report sits in the undo payload of the re-run's
  report update, and its deltas stay logged. Signal: users wanting
  either.

- **Re-running one task.** Tasks feed each other within and across
  parts, and deltas carry no task. Signal: whole re-runs used to fix
  one area.
- **Steering a re-run.** On one model a re-run is mostly a reroll that
  can repeat the first run's mistakes: a note from the user, or the
  first run's report shown to the second. Signal: re-runs that don't
  improve.
