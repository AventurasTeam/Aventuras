# Re-running a chapter's close

How the user runs a chapter's close again when its output is poor, and
trades a worse second run back for the first. Designed 2026-11-13;
resolves the UX followup "Re-run a chapter's close" and the
Timeline's open question on re-running lore management, and adds
Slice 5.13 to M5. Revised the same day after 5.13's planning audit
broke the first design's reversal; see [Revision](#revision).

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
- **The substrate assumes one birth per row.** `writesTo`
  (`lib/actions/delta/row-closure.ts:91`) takes every write to a row
  whose create is undone, with no lower bound, and `loadHeldRows`
  (`held-rows.ts:65`) treats any delete in the log as holding a row
  that is gone.
- **The reversal plan separates row writes from log prunes.**
  `buildReverseAndPrunePlan` (`reverse-replay.ts:81`) returns the row
  ops, the prunes and the row patches apart.
- **The report is an `updateChapter` delta** in the close's own group,
  source `chapter_close`, anchored on the end entry
  (`lib/pipeline/definitions/chapter-close-report.ts`), recording its
  group's `actionId` (C4).
- **Rollback can't be undone**
  ([`rollback-confirm.md → Confirmation modal`](../ui/screens/reader-composer/rollback-confirm/rollback-confirm.md#confirmation-modal--post-click)).
- **`undoLastAction` passes a running run only for a turn**
  (`lib/actions/story-entries/undo.ts:80`): CTRL-Z whose target is a
  close or an edit is refused while one runs.
- **`Regenerate summary` is M7.2**, disabled until then.

## Decisions

- **Undoable, durably, while it's the latest action.** CTRL-Z after a
  re-run restores the first close across restarts, and a failed,
  cancelled or crashed re-run leaves the first close standing. After a
  turn or an edit, CTRL-Z reaches the re-run only through them. It
  can't be redone. Rejected: holding the first close in memory, which a
  restart or a crash loses; and no undo at all.
- **Lore work only.** Phases 3 and 4 and the in-code steps re-run. The
  chapter row, its end, stamps, title and summary stay; metadata is
  `Regenerate summary`'s. Rejected: re-running metadata, which must
  decide about a title the user edited and overlaps M7.2; and a
  re-close with a new end, which moves stamps and the open region.
- **The current model**, the `lore-mgmt` assignment or the story's
  override. Rejected: a per-run profile pick.
- **Latest chapter only**, as Delete.
- **Before the next turn.** A re-run runs on a chapter no turn has
  followed since its latest close or re-run, and never while a close is
  owed. When turns have followed, it rolls them back first, telling the
  user, as a shortcut for rollback then re-run. Rejected: re-running
  over later turns, which needed a chain precedence over owed closes, a
  CTRL-Z rule mid-run, partial restores under later writes, copy about
  turns that reflect reversed facts, and a third of the test matrix,
  for a re-run C11 and C12 make weaker anyway.
- **Its own slice, 5.13,** after 5.10, 5.11 and 5.12.

## The journaled reversal

**What it reverses.** The chapter's lore work: every delta in its
close groups except those on `chapters` and `story_entries`, the
complement of `Remove divider only`'s seed. A chapter's close groups
are the `chapter_close` groups with a delta on its row.

**How.** As a delete: `selectReversalSet` with `yieldTo: 'any'`, then
`buildReverseAndPrunePlan`, pruning. In the same transaction, before
the ops run, it writes a journal of before-images: every row the plan
writes, whole or absent, and every delta row it prunes or edits. One
`reversal_journals` row, keyed by the re-run's `action_id`.

**Restore.** When the re-run's group reverses (CTRL-Z, an abort, crash
recovery), the same transaction writes the journal back after the
group's own deltas reverse: rows and delta rows to their before-images,
deltas at their first log positions, embedded rows flagged stale. Exact,
since nothing else wrote in between: the gate holds through the run,
and CTRL-Z refuses when a delta outside the group was logged after it
began. A rollback or delete taking the group takes the journal; a later
re-run's journal holds this one's row as a before-image.

**What follows.** The re-run's group holds only its own writes, so the
review, the close tools' `closeWrote` and lore growth bound, C12 and
History need no scoping, and a re-run can merge what the first close
merged. No union of a chapter's groups replays deltas that cancel, so
every confirm keeps counting the set's rows. Because the journal is
physical, redo's `held-in-redo` and `pruned-outside-redo` don't apply.

## The run

1. **Catch-up passes** while an entry through the chapter's end is
   unprocessed, counted through that end, not the branch's whole
   backlog. `pendingRerun: { chapterId }` lives for the chain: written
   as it starts, cleared as it ends, whatever ends it.
2. **The journaled reversal**, one write.
3. **Run order steps 4 to 9**, with parts cut from the chapter's
   entries, not the open region.
4. **The report** updates the existing row with the re-run's `actionId`.

Starting refuses as the manual close's start does, then `not-latest`,
`no-close`, a close owed, `counts-changed` and the pre-flight, all before
any shortcut rollback commits.

| Outcome               | Result                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| Commit                | `Chapter 5's close re-ran`, with `Review`; a warning when tasks stopped early                  |
| Cancel / interrupt    | The group reverses, the journal restores; `Re-run cancelled. Chapter 5's close is as it was.`  |
| A failed call         | The same; warning `Re-run failed. Chapter 5's close is as it was.` with the reason, no `Retry` |
| A catch-up pass fails | The chain ends as a failed pass's does; the re-run doesn't run and isn't owed                  |
| Crash                 | Boot recovery reverses the group and restores the journal, else undoes the close               |

**Head reversals.** One reaching the chapter (a rollback into it, or a
regenerate of a manual close's end reply) is held until the re-run
ends: once the reversal commits, the first close's lore sits in the
journal, where no confirm can count it. CTRL-Z is refused while a
re-run runs; Cancel stops it.

## The UX

**Entry points,** on the latest chapter a close wrote, disabled while a
run is in flight or a close is owed: `Re-run close…` on the Timeline
card, between `Review changes` and `Delete…`, in the phone overflow;
`Re-run…` in the review window's footer, its confirm stacking over the
window.

**The confirm** names the model and the chapter's token count, counts
as Delete's, and, when turns followed the close, adds the turns it
removes first with the rollback modal's counts and "They go for good,
even if the re-run fails or you cancel it." Its last line:
`CTRL-Z brings this close back until your next turn, edit or rollback.` Primary,
not destructive. The sketch is canon's
([`chapter-timeline.md → Re-run a close`](../ui/screens/chapter-timeline/chapter-timeline.md#re-run-a-close)).

**The review after a re-run** shows its report against the chapter
before any close, and closes when its report changes.

## Revision

The first design kept the first close restorable by a **logged
reversal**: the re-run logged its reversal of the close as new deltas,
so the close's deltas stayed in the log and an ordinary group undo of
the re-run brought them back. Its load-bearing assumption, that those
forward deltas undo cleanly, was marked "assumed, not prototyped", and
5.13's `code` and `seams` audits broke it. Bringing back a row the close
merged away logs a second `create` of that id while the close's
`delete` stays:

- undoing that `create` took the row's whole history with it, since
  `writesTo` has no lower bound, on every Cancel and failure;
- `loadHeldRows` held the live row, so `snapshotForRedo` refused CTRL-Z
  of the re-run and of any later edit to the row;
- the close tools' "rows this close wrote" reads counted the reversal,
  and a re-merge would write and delete one row in one action, which
  redo can't restore.

`merge_threads` is on main, so this hit most chapters. Patching the
three substrate rules was rejected for the journal, which never
re-creates a row. The same session dropped re-runs over later turns
(Decisions) and redo of a re-run, and the net counts and
`reversedThrough` the logged design needed went with it.

The second `code` audit, on the journal, bounded it:

- **Redo.** CTRL-Z of a re-run must clear the redo stack, or a later
  edit's snapshot redoes the re-run's undone value with no delta behind
  it.
- **Exactness.** A rollback or regenerate of a turn between the chapter's
  end and the re-run sweeps from below it, and failure paths that drop
  the gate can leave an orphan under later turns. Both make the journal
  inexact. Such a sweep drops the journal, the write-back checks the
  group, and without the journal the re-run's reversal undoes the
  chapter's close altogether, as Delete does. Rejected: reversing the
  re-run alone, which leaves the first close's report over lore that's
  gone; and blocking those reversals, routine after an auto close.
- **Held reversals.** A confirm can't count lore in the journal, so a
  head reversal reaching the chapter waits for the re-run to end.
- **Smaller fixes:** embeddings, store patches, newest-first recovery.

## Adversarial pass

**Load-bearing assumption.** The journal's write-back is exact. It
holds while nothing but the re-run's writes and their undo touched what
the journal covers. The gate covers a normal abort, CTRL-Z checks that
the group is whole and nothing foreign sits above it, and a sweep from
below the re-run drops the journal. Where it can't hold, the re-run's
reversal undoes the chapter's close altogether. Checked against the
write paths by the second code audit, not prototyped.

**Accepted:**

- Trading back works only while the re-run is the latest action, and the
  first run's review goes once it lands. Raised by a side review; the
  copy says so, and a previous-run view and a later restore are parked.
- The shortcut's turns can't be recovered, even if the re-run fails.
  Re-running on a fork is parked for M6.1.
- CTRL-Z of a re-run refuses when a pass logged above it, only possible
  through a pass's `Retry` or `Run now`.
- A later write's own undo can restore a value the reversal removed, as
  after a Delete; with no turn since the close, only a user edit or a
  pass can.

**Checked by reasoning:**

- A re-close after `Remove divider only` at the same end: the new
  chapter's close groups hold only its own close, so a re-run leaves the
  kept work.
- `Remove divider only` after a re-run keeps the re-run's lore deltas and
  their journal, so a later CTRL-Z of them restores the first close's
  lore without a divider, as kept work does.
- Several re-runs: each journals the last, and CTRL-Z steps back one run
  at a time.
- A close writes no display translations until M8.1 (the code audit).

**Unverified, for 5.13's planning:** the reversal's commit and the
journal write on Android, against Slice 5.2's 1.1 s stamp burst.

## Parked

- **Re-running one task.** Tasks feed each other and deltas carry no
  task.
- **Steering a re-run.** A note, or the first run's report shown to the
  second.
- **Comparing runs, and trading one back later.** A previous-run view
  has a cheap path; a later restore doesn't.
- **Re-running on a fork,** keeping the turns the shortcut removes
  (M6.1).
