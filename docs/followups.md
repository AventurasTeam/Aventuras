# Follow-ups

Top-level ledger of **active** outstanding items — design questions
or work the current milestone (v1) needs answered, or that block
other v1 work. Resolved items are **removed** (not crossed out); the
commit that resolves an item carries the resolution narrative.

Items confirmed for a future milestone or parked indefinitely
pending signal live in [`parked.md`](./parked.md). Movement between
the two files is normal as scope clarifies; see
[`conventions.md → Followups vs parked`](./conventions.md#followups-vs-parked)
for the placement rule.

## Data-model

- **4.2c planning gate — Reversals leave link rows and delete payloads
  out of step with the log.** Two mirrored gaps in one design item:
  live link rows still naming a row a reversal removed, and rows a
  delete captured in its payload whose history a reversal pruned.
  Settle both in a design session and close this entry before 4.2c is
  planned: its merge re-key question
  ([`02c-collision-review.md → Open questions`](./implementation/milestones/04-world-plot-read-surfaces/slices/02c-collision-review.md#open-questions))
  adds captured rows if it picks new rows plus the cascade. The
  developer chose this over landing option (a) alone (triage,
  2026-10-04). The two triage entries follow as filed.

  **`row-closure.ts`'s `CHILD_TABLES` widens a reversal set only for
  happenings' children.** A reversal deleting a character a create made
  orphans relationship, involvement or awareness rows naming it that
  were written in a different action group. Read, not reproduced;
  pre-existing (2026-09-28, raised by 4.2b).

  **A link an entity delete captured can come back with no delta.**
  An entity delete keeps the link rows it cascades only in its own undo
  payload. When a later reversal removes the machine write that created
  one of them, that create-undo finds the row already gone and prunes
  its delta; undoing the entity delete then restores the row through
  the live-link filter, since both its ends are live, and nothing left
  in the log can reverse it. Follow-up (developer decision on the 4.2b
  stack review, R1 option a): a create-undo of a link row that is
  already absent also strips that row from the delete payload that
  captured it — the contract between the reverse-replay closure and
  the delete cascade payload
  ([generation-pipeline.md → Reverse-replay](./generation-pipeline.md#reverse-replay)).
  Both triggers were probed with a scratch test on the 4.2b head:
  - **A periodic pass reversed mid-burst.** The pass is abort-free
    once its single model call returns, so the window is its write
    burst: the user deletes a character between two of its writes,
    then a later write fails (any rejection but a `noop`, or a throw,
    aborts the run and reverse-replays it) or boot recovery reverses
    the pass.
    Reproduced for a relationship between two characters the pass
    didn't create. Involvement and awareness rows can't hit it: the
    classifier writes them only under a happening created in the same
    pass, which the reversal deletes, so the live-link filter drops
    them. CTRL-Z never reverses a pass's writes: its bracket cancels
    an in-flight pass, which either stops before its first write or
    lands its whole burst first.
  - **A prose edit's sweep, with no timing window.** The user deletes
    a character, then edits the head turn's prose, whose sweep reverses
    the periodic facts anchored to it; CTRL-Z the edit, then CTRL-Z
    the delete. Reproduced for a relationship anchored to the head turn
    between characters that survive, and for awareness anchored to the
    head turn under a happening anchored to an older turn, which the
    sweep keeps. Not for an involvement: it shares its happening's
    anchor, so the sweep deletes the happening too.

  Option (a) as worded covers creates only. A swept pass update to a
  captured row is pruned the same way: a relationship view the pass
  changed from `ally` to `rival` comes back as `rival` when the
  delete is undone, though that row keeps its older create delta. A
  rerun doesn't duplicate a restored row: awareness and relationship
  writes are upserts behind unique indexes (`haw_natural_uniq`,
  `char_rel_pair_uniq`) and update it in place. `happening_involvements`
  has no such index, and `createHappeningInvolvement` doesn't check for
  an existing link, but the classifier emits involvements only under a
  happening it creates (2026-09-30, raised by the 4.2b stack review).

  The deleted row itself has the same gap, which option (a) doesn't
  reach. A happening the pass wrote from the head turn, deleted in
  Plot: edit that turn's prose, CTRL-Z the edit, CTRL-Z the delete. The
  happening and its links come back with no delta, the pass's rerun
  writes the happening a second time, and a later rollback removes only
  one. In the prose-edit trigger above, the same rollback also leaves
  the untracked awareness row naming a happening that is gone. Probed
  through the pipeline and the delete, edit, undo and rollback actions
  at the 4.2b review head (`1428e5b8`), not re-run on `main`
  (2026-09-30, from a slice-review skill test).

  **Corrections from the 2026-10-04 triage pass** (read on `main`, not
  re-reproduced):
  - The first gap's live trigger is CTRL-Z, not the closure path.
    `undo.ts` reverses through `reverseAndPruneDeltaRows`, which never
    runs `closeOverRemovedRows`, and `selectUndoTarget` skips
    periodic-classifier groups: create a character, let a pass link
    her, CTRL-Z, and the pass's relationship, awareness and involvement
    rows still name her. A prose edit's sweep never deletes an entity
    (`isReversible` drops entity creates). Widening `CHILD_TABLES`
    alone misses the CTRL-Z case.
  - "CTRL-Z never reverses a pass's writes" is false as worded: undoing
    a turn sweeps the pass facts anchored to it. What holds is that
    CTRL-Z never reverses a pass mid-burst.
  - The second gap also reaches happening deletes, which capture their
    links the same way (`register-happenings.ts`), and the deleted-row
    case reaches entities too, through an abort.
  - About 200–400 lines across `row-closure.ts`, `reverse-replay.ts`,
    `live-link-filter.ts`, `delete-cascade.ts` and canon. Two calls
    inside: whether CTRL-Z runs the closure (redo replays only the
    group, so links it sweeps wouldn't come back on redo), and whether
    a reversal reaching a deleted row pulls in the whole entity-delete
    group or prunes only the delete.
