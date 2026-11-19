# Re-running a close on a fork

Non-destructive branch-and-re-run path when turns have followed a closed
chapter. Designed 2026-11-19 to resolve the parked "Re-running a close
on a fork" item, building on
[`2026-11-19-fork-partition-and-copy-invariants.md`](./2026-11-19-fork-partition-and-copy-invariants.md).

## Why

Today, re-running a chapter's close when turns have followed it
([`chapter-close.md → Re-running a close`](../memory/chapter-close.md#re-running-a-close))
rolls those turns back first — permanently, even if the re-run fails or
is cancelled. Once M6.1 ships branch fork carrying close deltas and
`reversal_journals`
([`data-model.md → Branch model`](../data-model.md#branch-model)), the
user can keep the played turns on the original branch and re-run the
close on a new branch instead.

## Decisions

- **Offered only when turns followed the close, alongside in-place
  rollback.** With zero turns after the close, CTRL-Z already trades the
  re-run back for the prior close, so the 2-button in-place dialog stays
  unchanged. When turns followed, the confirm offers both:
  **Re-run on new branch** (primary, non-destructive) and
  **Roll back & re-run** (destructive, today's shortcut). Rejected:
  replacing in-place rollback outright, and offering fork even at zero
  post-close turns.
- **Auto-named (`Ch. <seq> re-run`), zero extra input.** Keeps the
  confirm a clean 3-button `AlertDialog` matching
  [`ChapterDeleteConfirm`](../ui/screens/chapter-timeline/chapter-timeline.md#delete-a-chapter).
  Short enough to fit the 360px branch navigator without truncating,
  does not snowball across repeated forks, and `branches.name` permits
  duplicates by design
  ([`branch-navigator.md → Name uniqueness`](../ui/screens/reader-composer/branch-navigator/branch-navigator.md#name-uniqueness));
  user can rename anytime in the navigator. Rejected: inline editable
  name input or a two-step name modal.
- **Keep the new branch on cancel or failure.** Two committed actions —
  fork+switch, then re-run — symmetric with in-place rollback+re-run.
  If the re-run fails or is cancelled, its journal restores the copied
  prior close and leaves the user on the clean new branch at the close
  point, ready to retry `Re-run close…` with zero turns after it or
  switch back and delete the fork. Rejected: auto-deleting a
  "provisional" branch (complicates retry and crash recovery).
- **Switch active branch and land on the new branch's Reader.** The
  branch chip is reader-only chrome
  ([`principles.md → Reader-only chrome`](../ui/principles.md#reader-only-chrome)),
  so staying on Chapter Timeline hides the branch switch and leaves the
  parent branch's `reader-composer/[oldBranchId]` frame sitting
  underneath on the navigation stack. Landing on
  `reader-composer/[newBranchId]` (replacing the in-story stack,
  matching [`branch-navigator.md → After confirm`](../ui/screens/reader-composer/branch-navigator/branch-navigator.md#after-confirm))
  shows the updated branch chip (`⎇ N+1`), the rewound tail, and live
  progress in `MemoryRunBanner`. Rejected: staying on Timeline or
  running a background close on an unloaded branch.

## The design

### Pipeline & orchestration

**Fork point (`N`).** Let `B` be the exact entry that in-place re-run
would roll back from — the start of the earliest turn with an entry
written after the chapter's latest close or re-run (a reply regenerated
since takes its player's action with it). `N` is the highest-position
non-system entry strictly before `B`.

- For an auto-close or head manual close, `N` equals
  `chapter.end_entry_id`.
- For an earlier manual close with pre-close open-region turns standing
  before `B`, `N` is the last pre-close open-region entry, not
  `end_entry_id`. That makes the fork's state byte-identical to what
  in-place rollback leaves: the pre-close open-region turns stay (so the
  re-run reads the exact same open region the close did), and any prior
  re-run's journal sits below `L(B)` and survives intact (Case 3 of
  [`data-model.md → Branch model`](../data-model.md#branch-model)).

**Pre-conditions & refusals (all checked on `parent` before any write):**

- Every existing re-run start refusal: pre-flight, chapter still the
  latest with a close, `counts-changed` against the dialog's preview,
  and no close owed on the post-fork region.
- Every fork pre-condition: generation gate idle on `parent`,
  `parent.classifier_status.state !== 'running'`, no pending embedder
  swap on the story.

**Two-action sequence:**

1. **Fork + switch (action 1):** Run the atomic branch fork of `parent`
   at `N` with name `Ch. <seq> re-run`, update
   `stories.current_branch_id = newBranchId`, re-hydrate stores on
   `newBranchId`, clear `undoRedoStore`, close the Review window (if
   open), and navigate to `reader-composer/[newBranchId]` replacing the
   in-story stack. `parent` is untouched.
2. **Start re-run (action 2):** Start the standard zero-post-close-turns
   re-run on `newBranchId` for the same `chapterId` (composite PK keeps
   `chapterId` unchanged). Its reversal journals the copied prior close's
   deltas, so CTRL-Z, cancel, failure, or crash recovery restores the
   copied close on `newBranchId`.

**Outcomes:**

- **Refusal or fork DB failure in step 1:** Nothing committed; user
  stays on `parent` with the refusal/error toast.
- **Step 1 commits, step 2 fails/refuses unexpectedly:** Still close the
  Review window and route to `reader-composer/[newBranchId]` (so the
  route matches `stories.current_branch_id`) and raise a warning toast:
  `Branched "Ch. <seq> re-run" from entry <pos>, but couldn't start the re-run. Retry from Chapter Timeline.`
- **Cancel, provider failure, or crash during step 2:** The new branch
  stays; abort / failure / boot recovery restores the copied prior close
  via its journal, leaving the user on `newBranchId` at `N` with the
  standard re-run cancel/failure toast.

### UI surface (`chapter-timeline.md` + `chapter-timeline.html`)

- **Dirty card edits:** On Timeline, `Re-run close…` (and Review's
  `Re-run…` when Timeline owns a dirty card) routes through the
  save-session `guard` _before_ opening the re-run confirm — matching
  `Delete…` (`guard(() => void deleteConfirm.open(card.row.id))`). Never
  stacks `UnsavedChangesDialog` on top of the re-run confirm, and any
  saved edit commits to `parent` before preview counts are read.
- **Zero turns followed:** Unchanged 2-button `AlertDialog`
  (`Cancel`, `Re-run close` primary), no turns block.
- **Turns followed:** 3-button `AlertDialog` (deliberate departure from
  [`alert-dialog.md`](../ui/patterns/alert-dialog.md), matching
  `ChapterDeleteConfirm`):
  - Shows the turns-followed counts (`• 6 entries (91–96)`,
    `• 12 world-state changes`).
  - Explains both choices beneath the counts:
    `Re-run on new branch keeps them on <branch> and branches from entry <pos> as "Ch. <seq> re-run".`
    / `Roll back & re-run removes them for good, even if the re-run fails or you cancel it.`
  - Footer: `[ Cancel ]` `[ Roll back & re-run ]` (destructive)
    `[ Re-run on new branch ]` (primary). All three disable while the
    fork or rollback commits.
- **After `Re-run on new branch`:** Reader opens on `newBranchId` at
  entry `N` with the updated branch chip (`⎇ N+1`), `MemoryRunBanner`
  showing live re-run progress, and an info toast:
  `Branched "Ch. <seq> re-run" from entry <pos> — re-running chapter <seq>'s close.`

## Adversarial pass

- **Dirty card edit + Save-before-fork trap** (verified in
  `app/chapter-timeline/[branchId].tsx:193`): running `guard` _after_
  the confirm opened would stack three modals over the Review window and
  log a `chapters` `user_edit` (`entry_id = null`) at `log_position > L(B)`
  that the fork's rewind would immediately undo. Gating `Re-run close…`
  through `guard` _before_ opening the confirm (matching `onDelete`)
  eliminates both.
- **Step 1 ok / step 2 fail split-brain:** Covered explicitly by routing
  to `reader-composer/[newBranchId]` anyway and warning with a Retry
  toast so the route never disagrees with `stories.current_branch_id`.
- **Re-running on a fork of an already-re-run chapter:** Piece 1 Case 3
  copies the prior re-run's journal `J2` onto `newBranchId`; the new
  re-run writes `J3` holding `J2` as a before-image, so cancel or CTRL-Z
  restores `J2` with `branch_id` re-stamped.
- **Manual close before head / opening fork / tail system banner /
  single-branch story / Reader Review window:** `N` = last non-system
  entry before `B` handles pre-close open-region turns and `N = 1`
  (`opening`); tail `kind='system'` entries don't count as turns and
  don't copy; creating branch #2 reveals `[⎇ 2]` on the Reader; Review
  window opened from Reader's commit banner follows the exact same close
  - replace-route flow.
- **Inbound links checked:** Three inbound links pointed to the parked
  entry (`docs/memory/chapter-close.md:1268`,
  `docs/implementation/roadmap.md:260`, and
  `docs/implementation/milestones/05-chapters-chapter-close/slices/13-close-rerun.md:679`);
  all three update in the same commit.

## Integration plan

**Canonical files:**

- `docs/memory/chapter-close.md`
  - `## Re-running a close`: document the `Re-run on new branch` path
    beside in-place rollback (fork point `N`, pre-fork refusals,
    two-action sequence, auto-name `Ch. <seq> re-run`, outcomes
    including step-1-ok/step-2-fail recovery); remove "and re-running on
    a fork" from the parked list at the end of the section.
- `docs/ui/screens/chapter-timeline/chapter-timeline.md`
  - `### Re-run a close`: update the dialog mockup, copy, and button
    hierarchy for the turns-followed 3-button variant (`Roll back &
re-run` destructive, `Re-run on new branch` primary), note the
    pre-confirm `guard` for dirty cards, post-fork navigation to
    `reader-composer/[newBranchId]`, Review-window close, and toast
    copy.
- `docs/ui/screens/chapter-timeline/chapter-timeline.html`
  - Update the `rerun-backdrop` dialog and `data-rerun-turns` CSS so
    `none` renders the 2-button in-place dialog and `some` renders the
    3-button fork-or-rollback dialog with the new copy and destructive /
    primary button variants.
- `docs/parked.md`
  - Remove `#### Re-running a close on a fork` (resolved).
- `docs/implementation/roadmap.md`
  - `### M6 — Branches + diff cache`: replace the parked pointer in
    M6.1's prerequisites note with an M6.3 build item for
    `Re-run on new branch` (lands alongside M6.3's branch-aware reader
    routing over M6.1's fork core).
- `docs/implementation/milestones/05-chapters-chapter-close/slices/13-close-rerun.md`
  - `## Scope: out`: re-point the link from the removed `parked.md`
    heading to `chapter-close.md#re-running-a-close` (link update only).

**Renames:** none (one removed heading in `parked.md`, all inbound refs
swept above).

**Patterns adopted on a new surface:** none (`AlertDialog` 3-button
variant and `save-sessions` guard are already used on `chapter-timeline`).

**Followups resolved:** `docs/parked.md → Re-running a close on a fork`.

**Followups introduced:** none in `followups.md` (M6.3 build note added
to `roadmap.md`).

**Wireframes updated:** `docs/ui/screens/chapter-timeline/chapter-timeline.html`
(`rerun-backdrop` states under `data-rerun-turns="none"` vs `"some"`).

**Intentional repeated prose:** `chapter-timeline.md#re-run-a-close`
summarizes the fork point and cancel/failure outcome briefly for UI
context while deferring full orchestration details to
`chapter-close.md#re-running-a-close`.
