# Slice 6.6 — Branch delete and story duplicate

## Metadata

- **Milestone:** [Milestone 6 — Branches + diff cache](../milestone.md)
- **Depends on:** [Slice 6.1](./01-copy-substrate.md) (`pipeline_runs`
  in `BRANCH_SCOPED` with its branch, the unfinished-run read, the copier
  and its vector ops, the restore re-stamp: C1, C2, C3),
  [Slice 6.2](./02-scoped-reads-redo.md) (the redo map and its drop for a
  deleted branch, C6; the store accessor, C5) and
  [Slice 6.4](./04-switching-navigator.md) (the branch read and the open
  story's branch store, the navigator row's delete slot, the chip: C8).
  Not on [Slice 6.3](./03-fork-core.md): neither half forks.
- **Blocks:** none

## Goal

A user deletes any branch but the current one from the navigator, and
duplicates a story, one branch or all, from the story list. This delivers
`deleteBranch` with its count and its confirm, `dropBranchRecords`
covering every per-branch record, `duplicateStory` with its refusals, the
Duplicate dialog and the story list's wiring, and the canon lines both
change.

## Background

Both halves rest on Slice 6.1. A branch delete is the story delete's
cascade scoped to one branch: the same table list, which after 6.1 holds
`pipeline_runs`, then the branch's vec rows, a re-parent of its children
and the `branches` row; nothing undoes it, so the confirm counts what
goes. A duplicate runs 6.1's copier in duplicate mode for each copied
branch, under a new `stories` row and fresh `branches` ids, in one batch
with no lock and no deltas, and CTRL-Z in the copy works because 6.1
re-stamps restored rows. The refusals come from R1 (an unfinished run row
refuses a duplicate of its branch, and a delete takes the rows with it)
and from the switch's gate rule (C8), and canon gets R1 in the design
pass that lands before the tasks resting on it start (C12).

## Required reading

- [`data-model.md → Branch model`](../../../../data-model.md#branch-model):
  the manifest, the composite-key paragraph and **Deleting a branch**;
  [`Story duplicate`](../../../../data-model.md#story-duplicate);
  [`Story deletion`](../../../../data-model.md#story-deletion); and
  [`Assets`](../../../../data-model.md#assets-images--future-media), whose
  trash-can pattern this slice defers
- [`generation-pipeline.md → Multi-run txState`](../../../../generation-pipeline.md#multi-run-txstate),
  [`Gate derivation as a selector`](../../../../generation-pipeline.md#gate-derivation-as-a-selector),
  [`Startup recovery pass`](../../../../generation-pipeline.md#startup-recovery-pass)
  and
  [`Recovery-failure policy`](../../../../generation-pipeline.md#recovery-failure-policy),
  as R1's design pass leaves them
- [`branch-navigator.md → Row actions — inline icons`](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#row-actions--inline-icons),
  [`During generation`](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#during-generation--switch--delete--create-blocked),
  [`Delete confirm`](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#delete-confirm),
  [`Single-branch state`](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#single-branch-state)
  and
  [`Mobile expression`](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#mobile-expression)
- [`story-list.md → Story card — text-first`](../../../../ui/screens/story-list/story-list.md#story-card--text-first),
  [`Duplicate a story`](../../../../ui/screens/story-list/story-list.md#duplicate-a-story)
  and
  [`Mobile expression`](../../../../ui/screens/story-list/story-list.md#mobile-expression)
- [`alert-dialog.md → Body text`](../../../../ui/patterns/alert-dialog.md#body-text),
  [`Busy`](../../../../ui/patterns/alert-dialog.md#busy) and
  [`Copy contract`](../../../../ui/patterns/alert-dialog.md#copy-contract);
  [`overlays.md → Dialog — Busy`](../../../../ui/patterns/overlays.md#dialog--busy)
  and [`Close focus`](../../../../ui/patterns/overlays.md#close-focus)
- [`layout.md → Stacking`](../../../../ui/foundations/mobile/layout.md#stacking),
  [`icon-actions.md → Disabled vs hidden`](../../../../ui/patterns/icon-actions.md#disabled-vs-hidden),
  [`forms.md → Input primitive`](../../../../ui/patterns/forms.md#input-primitive),
  [`Select primitive`](../../../../ui/patterns/forms.md#select-primitive)
  and [`toast.md → Action button`](../../../../ui/patterns/toast.md#action-button)
- [`code-conventions.md → Syncing a store after a write`](../../../../code-conventions.md#syncing-a-store-after-a-write)
  and [`Forms`](../../../../code-conventions.md#forms)
- [`testing.md → Coverage`](../../../../testing.md#coverage-thorough-not-exhaustive),
  [`Fixture + seed contract`](../../../../testing.md#fixture--seed-contract),
  [`Tier 1 — assert in the database`](../../../../testing.md#tier-1--assert-in-the-database),
  [`The dataset seed`](../../../../testing.md#the-dataset-seed),
  [`Embedder in E2E`](../../../../testing.md#embedder-in-e2e) and
  [`Mock LLM`](../../../../testing.md#mock-llm), for the delete E2E's
  launch that holds a turn
- The milestone's contracts it consumes:
  [C1](../milestone.md#c1--delta-rows-on-two-branches),
  [C2](../milestone.md#c2--run-records-and-the-copy-refusal),
  [C3](../milestone.md#c3--the-manifest-and-the-copier),
  [C6](../milestone.md#c6--one-redo-stack-per-branch) and
  [C8](../milestone.md#c8--the-branch-list-the-switch-and-the-navigators-row);
  those it follows: [C5](../milestone.md#c5--branch-scoped-store-reads),
  [C7](../milestone.md#c7--fork)'s seed rule (last bullet),
  [C11](../milestone.md#c11--shared-files) and
  [C12](../milestone.md#c12--canon-and-flips); and
  [Definition of done](../milestone.md#definition-of-done) (Unfinished
  runs, Delete, Duplicate) and
  [Open questions](../milestone.md#open-questions) (Unaudited, Sizes,
  Unmeasured costs)
- Lessons:
  [A portaled overlay outlives screen focus](../../../lessons-learned/portaled-overlay-outlives-screen-focus.md),
  [Disabled under focus blurs on web](../../../lessons-learned/rnweb-disabled-under-focus-blurs.md),
  [rn-primitives' native Portal drops custom contexts](../../../lessons-learned/rn-primitives-portal-context.md),
  [A Content that renders the Portal is mounted](../../../lessons-learned/portal-owner-mount-is-not-open.md)
  and [No harmless id leaks](../../../lessons-learned/no-harmless-id-leaks.md)

## Scope: in

The refusal tasks of both halves start after R1's design pass lands in
canon (C12). Everything else starts once 6.1, 6.2 and 6.4 have merged.

**Branch records (C2).**

- `dropBranchRecords` (`lib/stores/generation/generation.ts:324-330`)
  drops `pendingRerun` and `heldBranches` beside `deferred` and
  `pendingClose`, in one update, and still returns the same state when
  the branch holds none of the four. Story delete calls it per branch
  (`lib/actions/stories/delete-story.ts:86`), so its leak of both records
  ends here too.
- The lint fence. The new `lib/actions/stories/delete-branch.ts` joins
  the files that may call `dropBranchRecords`: the record-writer block
  (`eslint.config.js:314-331`; the constant is at `:38-41`), and
  `RECORD_WRITERS` in
  `lib/stores/__tests__/generation-mutators-lint.test.ts:38-43` gains it.
  The mutator now also drops a re-run's record and a hold, which the
  `CLOSE_RECORD_MUTATORS` message doesn't describe, and only
  `delete-story.ts` calls it today. Whether it moves to an owner list of
  its own, the two deletes, is the plan's call; either way the pin test
  holds the new owner. A new owner block repeats every other ban the
  base block sets for `no-restricted-properties`, since a block replaces
  that rule's options for its files.
- Comments that go stale: `generation.ts:77-80` says `pendingRerun`
  clears only as the chain ends and nothing else clears `heldBranches`.
  Both now name a delete.

**The branch-only count.** `countBranchOnlyEntries(branchId, ctx)` in
`lib/actions/stories/delete-branch.ts`: one SQL read of the branch's
non-system entries whose id no other branch of the same story holds. The
"same story" is a join through `branches.story_id`, not decoration: a
duplicate copies entry ids into another story, and a count across stories
would read them as shared.

**`deleteBranch(branchId, ctx, listTables?)`** in the same file, exported
through `lib/actions/index.ts`, with `listTables` injected as
`deleteStory`'s is (`delete-story.ts:53-59`). In order:

1. Read the branch row (its story and its parent), the story's
   `current_branch_id` and the table list.
2. Refuse, writing nothing. The checks run after the last `await` before
   the batch, so nothing registers between them and `runInTransaction`.
   - `not-found`: no such branch.
   - `current`: the branch is the story's `current_branch_id` or the open
     branch. The row never shows `×` there (C8); this is the backstop.
   - `in-flight`: C8's gate, `isUserEditBlocked(txState)` with no branch,
     or the hold-free read 6.4 adds. Not
     `generationStore.isUserEditBlocked()` (`generation.ts:403-405`),
     which adds the open branch's hold and would refuse deleting any
     branch while the current one is held. A held branch stays deletable
     (R1), and so does any branch while another is held.
   - `swap-pending`: a swap is pending on the story, read by the same
     helper the duplicate uses (below), not `isStorySwapPending` alone.
3. One `runInTransaction` batch:
   - a delete per `BRANCH_SCOPED` table by the branch. After 6.1 that list
     holds `pipeline_runs`, so every run row of the branch goes, finished
     ones too: the column is a foreign key, and nearly every branch has
     finished rows (C2). The loop is `deleteStory`'s, scoped to one
     branch; extract one helper over branch ids that both call.
   - the vec rows, `deleteBranchVecOps(tables, [branchId])`
     (`lib/db/embeddings/vec-tables.ts:53-63`);
   - the re-parent: children of the branch take its parent, or null when
     it had none, with the parent read inside the statement by a
     subquery, so it reads the batch's snapshot. The self-FK is bare and
     immediate (`lib/db/stories/stories.table.ts:44`), so this precedes
     the row's delete. A child's `fork_entry_id` stays;
   - the `branches` row.
4. After the commit: `generationStore.dropBranchRecords(branchId)`, then
   6.2's drop of the branch's redo stack (C6), then the refresh of the
   open story's branch store (C8). The two drops come first and can't
   throw. The refresh's failure is logged, not surfaced, as C8 has it
   for the refresh after a switch's navigation; a delete has no
   navigation, so here it means:
   - a rejection is caught and logged, and the delete still returns
     `deleted`: it landed, and the confirm closes as on any success;
   - the deleted row stays in the navigator until the next refresh,
     which the reader's next mount or the next branch write makes;
   - the stale row can't do harm: a press on it meets the switch's
     refusal of a missing branch (C8), and its `×` opens a confirm
     counting 0 whose `Delete branch` gets `not-found`, on which the host
     closes the confirm and refreshes again.

It returns `deleted` or a typed refusal. It writes no delta, takes no
lock and evicts nothing (R3). No lock is needed: every run and every user
write targets the open branch, which this one isn't, and the gate is
checked. No asset is trashed: nothing writes assets yet, and the
refcount trash is M9.3's. The removed `entry_assets` rows simply go.

**The delete confirm.** `BranchDeleteConfirm`, in the folder holding
6.4's navigator (`components/reader/` unless 6.4 put it elsewhere), an
AlertDialog with props only, modelled on `ChapterDeleteConfirm`
(`components/chapters/chapter-delete-confirm.tsx`), not on
`DeleteConfirmDialog`: that one takes no `portalHost` and no pending
state, and closes through `AlertDialogAction` before an async confirm
settles (`components/compounds/delete-confirm-dialog.tsx:57-61`).

- Props: `open`, `onOpenChange`, `name`, `count`, `blockedReason?`,
  `pending?`, `failed?`, `portalHost?`, `returnFocusTo?`, `onDelete()`.
- Copy per canon, all inside `AlertDialogDescription`: the title,
  `Delete <name>?`; the count line, canon's `<N> entries` sentence with
  its singular, or its zero wording; the last line, that the branch's
  world, plot and chapter changes go with it and that it can't be undone.
- `Cancel` and `Delete branch` (destructive), as plain buttons, so the
  confirm stays up until the delete settles and the host closes it.
- States, defaults this slice adds to canon, which names none for a
  delete:
  - **pending**: `busy`, both buttons disabled, Esc and hardware back do
    nothing, since the batch can't stop partway;
  - **blocked**: `Delete branch` disabled, with the reason as a line above
    the buttons, while the gate closes or a swap becomes pending after
    the confirm opened; it re-enables when that lifts. A refusal returned
    at the press shows the same line;
  - **failed**: `Couldn't delete the branch.` inline, and the confirm
    stays open for a retry or Cancel.

**The reader's wiring.** In `app/reader-composer/[branchId].tsx` (C11:
the confirm's mount) and 6.4's navigator host:

- The navigator receives the delete handler only while C8's gate is open
  and no swap is pending (the route's `swapPending`,
  `[branchId].tsx:455-460`), so the row's own rule hides `×` then, as it
  does on the current branch (C8; hidden, not disabled, per canon).
- `×` reads the count, then opens the confirm. A failed read logs, toasts
  and opens nothing.
- On phone the confirm takes `portalHost={ABOVE_SHEETS_PORTAL_HOST}`, over
  the navigator's Sheet (precedent:
  `components/chapters/close-chapter-modal-view.tsx:506`); on desktop and
  tablet it takes the default host, over the Popover. Its `open` is gated
  on the route's focus, as the route's other overlays are
  (`[branchId].tsx:2022`).
- `blockedReason` reads the gate's reason and the swap live.
- On success the confirm closes, the row leaves, the header count drops
  and the navigator stays open. `returnFocusTo` names an element inside
  the navigator: the pressed `×` left with its row, and the overlay it
  opened from didn't close, so steps 3 and 4 of Close focus find nothing.
- **The chip waits for the navigator to close.** Its count holds while
  the navigator is open and updates when it closes, per canon. On desktop
  this is load-bearing: deleting the second of two branches would
  otherwise unmount the chip that anchors the open Popover. C8 has the
  chip and the navigator read one store, which the delete refreshes, so
  the latch goes in the chip's read or the navigator host's. Both are
  6.4's components, and this slice lands after 6.4. On phone the chip
  anchors nothing, but canon's timing holds there too, and the delete
  E2E checks the chip while the navigator is still open.

**Duplicate's refusals.** `checkStoryDuplicate(storyId, branch, ctx)` in
`lib/actions/stories/duplicate-story.ts`, where `branch` is a branch id or
`'all'`, returns the first refusal or none:

- `draft`: the story is a draft. The card offers no Duplicate there; this
  is the backstop.
- `swap-pending`: `isStorySwapPending`
  (`lib/embedder-swap/app-deps.ts:165-169`) sees a persisted marker only
  on the story `currentStoryStore` holds. Nothing clears that store on
  navigation (`hooks/use-chapter-progress.ts:26-29`), so on the list it
  still holds the last story opened, and every other card's marker goes
  unseen. The read takes
  `json_extract(stories.settings, '$.embedding_swap_target')` from the DB
  for the story asked about, plus the in-flight check, so a corrupt
  settings blob neither throws nor hides a marker. Missed, the copy would
  carry a paused swap's target and its staged vectors. One exported
  helper in `lib/embedder-swap`, which `deleteBranch` reads too. No other
  refusal here reads the open story: `run-registered` reads
  `txState.runs`, which holds every story's runs, and the last two read
  the DB.
- `run-registered`: a run in `txState.runs` on the story.
- `branch-held`: a copied branch whose `classifier_status.state` is
  `'running'`.
- `unfinished-run`: a copied branch with an unfinished run row, by 6.1's
  read (C2, R1). A `heldBranches` branch keeps its re-run's open marker,
  so this refuses it too: a copy of a held branch would carry a re-run
  that boot recovery reads by its action id.

**`duplicateStory({ storyId, title, branch }, ctx, listTables?)`** in the
same file, exported through `lib/actions/index.ts`:

- Re-checks the refusals, and a refusal writes nothing.
- Reads in JS before the batch: the source's branch rows (C8's read), the
  source's `current_branch_id` and the vec family list. These sit outside
  the batch's snapshot; Open questions has what a change in between does.
- Mints `generateId('story')` and one `generateId('br')` per copied branch,
  as `lib/actions/stories/create-story.ts:95-96` does.
- One `runInTransaction` batch, in canon's order:
  1. the `stories` row, as an `INSERT … SELECT` from the source row: the
     title bound; `description`, `tags`, `accent_color`, `cover_asset_id`,
     `definition` and `settings` copied whole; `status` `'active'`, from an
     archived source too; `favorite` 0; `created_at` and `updated_at` now;
     `last_opened_at` null; `current_branch_id` the copied branch, or in a
     full duplicate the copy of the source's current branch;
  2. the `branches` rows, parents before children (the self-FK is
     immediate): a fresh id under the new story, with `name`, `created_at`
     and `classifier_status` verbatim. A single-branch duplicate's branch
     has null `parent_branch_id` and `fork_entry_id`; a full duplicate
     remaps `parent_branch_id` to the copies' ids and keeps
     `fork_entry_id`;
  3. 6.1's copier in duplicate mode for each copied branch (C3): every
     table the manifest's Duplicate column copies, `system` entries
     included, deltas and journals whole, never `probe_captures` or
     `pipeline_runs`;
  4. the copier's vector ops, last.
- No lock, no deltas, no redo clear, no store patch, no eviction (C3, R3).
  `wizard_sessions` don't copy, and in-memory records don't carry.
- After the commit, `rehydrateStories`. It returns the new story's id.

Restores in the copy name the source branch in their payloads; 6.1's
re-stamp (C1) puts them on the copy, and this slice proves it through a
real duplicate.

**The Duplicate dialog.** `DuplicateStoryDialog` in
`components/story/duplicate-story-dialog.tsx`: a Dialog on every tier at
about 360 px, props in (the source title, its branch rows and current
branch, the refusal, the state, `onDuplicate`, `onOpenChange`). The name
and the branch are one cluster with a submit button, so they use
`react-hook-form` (Forms).

- **Name**: an Input, required, prefilled `<title> (copy)` through `t()`,
  focused with its text selected. `Duplicate` is disabled while it's empty
  or whitespace, and Enter confirms.
- **Branch**: a Select in `dropdown` mode, only when the story has more
  than one branch: the current branch first, marked `current`, then
  creation order, then `All branches (N)`. It defaults to the current
  branch.
- **States**:
  - checking: the branch read and the refusal check in flight, and
    `Duplicate` disabled;
  - refused: the reason as a line above the buttons, `Duplicate`
    disabled. The check runs again when the Select changes, since its
    refusals judge the copied branches;
  - copying: a spinner on `Duplicate`, the fields and `Cancel` disabled,
    `busy`; Esc, the backdrop and hardware back do nothing;
  - failed: `Couldn't duplicate the story.` inline, and the dialog stays
    open;
  - done: the dialog closes.

**The story list's wiring** (`app/index.tsx`).

- `StoryCardHandlers` (`components/story/story-list.tsx:27-34`) gains
  `onDuplicate?`. The host passes it for active and archived stories and
  leaves it out for drafts, as it does `onEditInfo`
  (`app/index.tsx:209-212`), so the card's item
  (`components/story/story-card.tsx:213-220`) shows only there.
- The dialog's open state joins `AppActionsMenu`'s `blocked`
  (`app/index.tsx:229`), and its `open` is gated on `isFocused`: a toast's
  `Open` can push a reader while a second dialog is up.
- On done: the dialog closes; the stories store has re-read inside the
  action; the chapter numbers re-read; then a success toast,
  `Duplicated as "<name>"`, whose `Open` calls `attemptOpenStory` with
  the new id (`app/index.tsx:158-182`). The user stays on the list.
- The chapter numbers need the explicit re-read. The hook's key,
  `['story-chapter-numbers', settleCount]`
  (`hooks/use-story-chapter-numbers.ts:37`), doesn't move on a
  duplicate, and `chapterLabelOf` renders `?? 1`
  (`lib/stores/stories/view-model.ts:13`), so the copy's card would read
  `Chapter 1`, not blank, until a refocus. Invalidate the key's prefix,
  or have the hook expose a refetch.
- **`Open` acts only from the list.** The toast is mounted at the root
  (`app/_layout.tsx:115`), so it outlives the list's focus. Pressed over
  another story's reader, `Open` would push the copy's reader on top and
  hydrate the copy's rows; Back would land on the first reader with
  stores holding another story, which renders empty and never
  re-hydrates (C5). So the host keeps the toast's id, dismisses the toast
  (`toast.dismiss`) when the list loses focus, and the `Open` handler
  does nothing unless the list is focused at the press, for a press that
  lands as focus leaves. Both live in one hook,
  `components/story/use-duplicate-done-toast.ts`.

**Cost.** A full duplicate of the dataset story (`pnpm db:seed:dataset`,
opened once first so its rows embed: the seed carries no vector), timed
around the batch on desktop and on the Android slot AVD, from a debug log
of the batch's duration and op count. The numbers go in Implementation
notes. A bad number reopens this slice's approach, not the layout
(milestone Open questions, Unmeasured costs); the Android run never
blocks the slice.

**Storybook and the inventory.**

- `BranchDeleteConfirm` stories at desktop and phone width: a count, one
  entry (the singular), zero, blocked, pending and failed.
- `DuplicateStoryDialog` stories at desktop and phone width: checking,
  one branch (no Select), several branches, an empty name, one per
  refusal reason, copying and failed.
- The navigator's row with a delete slot keeps 6.4's story, which passes
  a stub handler; this slice's stories are the delete flow's above.
- Shipped rows for `BranchDeleteConfirm` and `DuplicateStoryDialog` in
  `docs/ui/component-inventory.md` under Compounds — shipped.

**Canon, in the same PR.** Four of these belong to the batched design
pass that lands R1 to R3 in canon (C12); each is made here only if that
pass hasn't already made it. The rest are this slice's own.

- Owned by the batched pass, made here unless it already has:
  - `data-model.md → Branch model`, Deleting a branch: "The delete waits
    on the generation gate" becomes a refusal while the gate is closed,
    and `heldBranches` joins the records that go;
  - `generation-pipeline.md → Multi-run txState`: "deleting a story drops
    both records for each of its branches" becomes all four, by a branch
    delete too, and `heldBranches`' "nothing clears it" names the two
    deletes;
  - `code-conventions.md → Syncing a store after a write`: the owners of
    `dropBranchRecords` gain `delete-branch.ts`, and the paragraph says
    what it drops;
  - `story-list.md → Duplicate a story`: the Refused paragraph names an
    unfinished run.
- This slice's own:
  - `data-model.md → Branch model`, Deleting a branch: the asset trash
    deferred to M9.3, so the removed `entry_assets` rows go and no asset
    is trashed yet;
  - `branch-navigator.md → Delete confirm`: the trash-can sentence
    deferred the same way; the pending, blocked and failed states, and
    where focus lands after a delete;
  - `component-inventory.md`: the two shipped rows above.

## Scope: out

- The asset trash, its refcount and its boot sweep: M9.3.
- The copier, the manifest, the vector copy and its device probes, the
  restore re-stamp, `pipeline_runs.branch_id` and its place in
  `BRANCH_SCOPED`, and the unfinished-run read:
  [Slice 6.1](./01-copy-substrate.md).
- The redo map, its drop and story delete's drop of its stacks:
  [Slice 6.2](./02-scoped-reads-redo.md). This slice calls the drop.
- The navigator, its rows and paused state, the `×` slot, the chip, the
  branch read and its store, rename and the switch:
  [Slice 6.4](./04-switching-navigator.md). This slice passes the delete
  handler and adds the chip's latch.
- Fork, its refusals and the seed's real fork:
  [Slice 6.3](./03-fork-core.md). `⎇` and the creation modal:
  [Slice 6.5](./05-fork-from-reader.md).
- Diff-cache eviction: a delete and a duplicate evict nothing (R3);
  the cache is [Slice 6.7](./07-diff-cache.md)'s.
- Import's id minting: M9.4, which reuses this slice's remap rule.
- The story card's `⋯` as a phone Sheet, which canon asks for and the
  card doesn't do (it is a Popover on every tier): triage. Duplicate rides
  the card's Popover as it stands.
- Undoing a branch delete or a duplicate: canon has neither. Deleting the
  copy is the way back.
- A branch tree view or a branch detail view: canon's open questions.

## Acceptance criteria

**Branch records.**

- `lib/stores/generation/generation.test.ts`: `dropBranchRecords` drops a
  branch's `deferred`, `pendingClose`, `pendingRerun` and `heldBranches`
  in one notification; another branch's four stay; a branch with none of
  the four leaves the state object identical and notifies no one.
- `lib/stores/__tests__/generation-mutators-lint.test.ts`:
  `lib/actions/stories/delete-branch.ts` may call `dropBranchRecords` and
  no run mutator, no re-run record mutator and not `setCloseProgress`; a
  component file still may not call it.
- `lib/actions/stories/delete-story.test.ts`: a story delete drops each of
  its branches' `pendingRerun` and `heldBranches`, and leaves another
  story's.

**Branch delete.**

- `lib/actions/stories/delete-branch.test.ts`, on a story with A, B and
  B's child C, sharing ids as 6.1's two-branch fixture does, with vectors
  in two dim families and finished and unfinished run rows on B. Deleting
  B leaves:
  - no row with B's id in any `BRANCH_SCOPED` table, read by iterating
    the list, so `pipeline_runs` is included, finished rows and
    unfinished;
  - no vec row for B in either family;
  - C's parent equal to B's old parent, C's `fork_entry_id` unchanged,
    and no `branches` row for B;
  - A's rows, deltas, journals and vectors equal, table by table, to
    their state before.
- The same file: deleting a root branch with a child leaves the child's
  parent null, and deleting the story's first branch, when it isn't
  current, succeeds.
- The same file, refusals, each writing nothing: `current` by
  `current_branch_id`, and for the open branch; `not-found`; `in-flight`
  under a registered run, a pending turn and a reversal in progress;
  `swap-pending` from a persisted marker while `currentStoryStore` holds
  another story, and while it holds none.
- The same file: with the current branch in `heldBranches`, deleting
  another branch succeeds; deleting a branch in `heldBranches` succeeds
  and removes it from `heldBranches`.
- The same file: after a delete, B's records and B's redo stack are gone
  and a group pushed on A stays. With a mocked branch-store refresh that
  rejects, the drops still happen, the failure is logged, and the delete
  returns `deleted`, not a failure.
- The same file: deleting a branch that is already gone, as a stale
  navigator row would, reads a count of 0 and refuses `not-found`, writing
  nothing.
- The same file, the milestone's unfinished-run case: an unfinished
  re-run run row on B with its deltas and journal, while A holds a
  chapter and a journal under the same ids. After deleting B,
  `recoverInFlightRuns` returns no reversed run and no failure, and A's
  chapter, journal and deltas are unchanged.
- The same file, the count, with literal numbers: a B holding three
  entries of A's ids, two of its own and a `system` entry counts 2; a B
  holding only A's ids counts 0; a duplicate of the story in another story
  holding B's own ids leaves the count at 2.
- `components/reader/branch-delete-confirm.stories.tsx`, play: the count
  line with its number, the singular, and the zero line; `Delete branch`
  fires `onDelete` and leaves the confirm open; a `Blocked` story shows
  the reason and disables `Delete branch`; a `Pending` story disables both
  buttons and ignores Escape; a `Failed` story shows the inline line with
  both buttons live.
- `e2e/tests/branch-delete.spec.ts`, on the seeded hero story. Every
  launch reads the current branch, the other branch's identity and its
  entries from the DB (C7's seed rule), and takes no turn on the other
  branch. Three launches, since their setups conflict:
  - **The delete.** No embedder installed, so nothing drains and vectors
    move only through the delete, as `seedVectors` requires
    (`e2e/harness/db.ts:167-170`). Before launch, a new
    `e2e/harness/seed.ts` helper writes a finished run row on the other
    branch; after launch, `seedVectors` writes the other branch's vectors
    in both seeded families. Before the delete the spec records, per
    table with a `branch_id` column (found through `sqlite_master` and
    `pragma_table_info`) and per seeded vec family, the current branch's
    row count. Then:
    - the chip shows the story's branch count, 2, read from the DB, and
      the navigator from the chip shows `×` on the other branch's row
      only;
    - the confirm's count line shows a number above zero, equal to the
      other branch's non-system entry ids less the current branch's,
      computed in the spec from the two id lists, not by the action's
      query. It is above zero under either seed: before Slice 6.3 the
      fork's entries are all its own, and after it the seed appends
      turns of the fork's own (C7);
    - `Delete branch` leaves the navigator open with one row and
      `Branches · 1`, while the chip still shows 2; once the navigator
      closes the chip is gone;
    - the DB holds no row on the deleted branch in any table with a
      `branch_id` column, `pipeline_runs` included, no vector for it in
      either family and no `branches` row, and each recorded count on the
      current branch is unchanged.
  - **Hidden while a run holds the gate.** The embedder installed
    (`installEmbedderModel`), since retrieval runs ahead of the narrative
    and a turn without one fails before anything is held
    (`e2e/tests/reader-undo-redo.spec.ts:33-39`); no `seedVectors`. With
    `holdNextNarrative()` armed, a Send on the current branch holds; the
    navigator then shows no `×` on any row. After `releaseNarrative()`
    and the turn's settle, `×` shows on the other branch's row, so the
    hidden state is the gate's.
  - **Hidden under a pending swap.** A swap marked pending on the story
    before launch (`markSwapPending`). The open raises the swap's resume
    prompt, which the spec defers, as `e2e/tests/embedder-drain.spec.ts`
    does. The navigator then shows no `×` on any row, and its rows aren't
    paused, since a swap doesn't pause switching.

**Story duplicate.**

- `lib/actions/stories/duplicate-story.test.ts`, one branch of a
  two-branch story with an archived, favorited source:
  - a fresh `story_` id and a fresh `br_` id;
  - every row id of every copied table kept, with `branch_id` the new
    branch; `system` entries, deltas and journals copied; no
    `probe_captures`, `pipeline_runs` or `wizard_sessions` row copied;
    the vectors copied with their `pk` built for the new branch;
  - the `stories` row per canon's field rules: the given title, `active`,
    `favorite` 0, `last_opened_at` null, `current_branch_id` the copy,
    and the other fields equal to the source's;
  - the branch's `name`, `created_at` and `classifier_status` verbatim, and
    null `parent_branch_id` and `fork_entry_id`;
  - the source's rows, its redo stack and its `branches` unchanged.
- The same file, all branches of a three-level tree (A, its child B, B's
  child C): three fresh branch ids, each parent remapped to its copy,
  `fork_entry_id` kept, and `current_branch_id` the copy of the source's
  current branch when that is B.
- The same file, refusals, each writing nothing: a draft; a run registered
  on any branch; a copied branch with `classifier_status.state`
  `'running'`; a copied branch with an unfinished run row, while a
  single-branch duplicate of the story's other branch succeeds; a swap
  marker in the DB while `currentStoryStore` holds another story, as it
  does on the list after a story was opened; a swap in flight.
- The same file, CTRL-Z in the copy: the source branch holds a delete
  group whose payload captured children. With the stores hydrated on the
  copy's branch, `undoLastAction` restores the rows on the copy, and the
  source's rows and deltas are unchanged; `redoLastAction` on the copy
  leaves the source alone too.
- The same file, a source branch vanishing mid-duplicate: a leaf branch
  deleted between the branch read and the batch (a `ctx` whose
  `runInTransaction` runs the delete first) yields a copy without it and
  nothing on the gone branch.
- `components/story/duplicate-story-dialog.stories.tsx`, play: a
  `Checking` story with `Duplicate` disabled; the name prefilled with the
  copy suffix; `Duplicate` disabled on a blank name;
  Enter fires `onDuplicate` with the name and the branch; the Select
  lists the current branch first with its mark and `All branches (N)`
  last, and is absent with one branch; a refused story shows the line and
  disables `Duplicate`; a `Copying` story disables the fields and `Cancel`
  and stays open on Escape; a `Failed` story shows the inline line.
- `components/story/use-duplicate-done-toast.test.tsx` (jsdom, mocked
  `toast` and open): a done shows the success toast with `Open`; focus
  going false dismisses it by its id; an `Open` pressed while the list is
  unfocused opens nothing; one pressed while focused opens the copy.
- `e2e/tests/story-duplicate.spec.ts`, on the seeded hero story:
  - `⋯ → Duplicate` shows the name prefilled from the title read from the
    DB, and the Select with the current branch first and
    `All branches (2)`;
  - duplicating the current branch adds a `stories` row with that title
    and one branch whose entry ids equal the source branch's, and shows
    the toast;
  - the copy's card shows the same `Chapter <n>` as the source's, `n`
    read from the DB;
  - duplicating `All branches (2)` adds two branches, the child's parent
    the copy of the parent;
  - with a swap marked pending before launch (`markSwapPending`), the
    dialog shows the refusal line and `Duplicate` is disabled;
  - the toast's `Open` lands the reader on the copy
    (`currentBranchId(page, copyId)`), and Undo there reverses the copy's
    newest group while the source keeps its rows (Open questions: the
    group).

**Cost.** Slice 6.6's Implementation notes record the duration and op
count of a full duplicate of the embedded dataset story on desktop, and
on the Android slot AVD or why that run didn't happen.

**Canon.** At the PR's head, whoever made each edit, which this checks
by state: `data-model.md → Branch model` names no asset trash before
M9.3, and a refusal, not a wait, under the gate;
`branch-navigator.md → Delete confirm` has the three states and no trash
before M9.3;
`generation-pipeline.md → Multi-run txState` names both deletes as
dropping `pendingRerun` and `heldBranches`; `code-conventions.md` lists
`delete-branch.ts` among the owners of `dropBranchRecords`;
`story-list.md → Duplicate a story` names the unfinished-run refusal;
and `component-inventory.md` has the two shipped rows.

**Gates.**

- `pnpm lint`, `pnpm typecheck`, `pnpm lint:docs`, `pnpm format:check`,
  `pnpm compiler:check` and `pnpm test:run` pass.
- `pnpm test:e2e e2e/tests/branch-delete.spec.ts e2e/tests/story-duplicate.spec.ts`
  passes after `pnpm build:web`.
- On the Android slot AVD, at phone width, never blocking: the confirm
  over the navigator Sheet, hardware back closing the confirm and leaving
  the Sheet, and `⋯ → Duplicate` through to the toast. Desktop smoke
  through the `electron-app` MCP.

## Tests

- **Unit, `--project unit`.** `generation`, the mutator lint,
  `delete-story`, `delete-branch`, `duplicate-story` and the done toast's
  hook. Tests seed through the DB on 6.1's two-branch fixture and its
  copier; none derives an expected count from the code under test.
- **Storybook, browser project.** `BranchDeleteConfirm` and
  `DuplicateStoryDialog`. Storybook mounts no above-sheets portal host, so
  the confirm's stories pass none; the stacking over the phone Sheet is
  the device check's.
- **E2E, desktop.** The two specs above, driving the UI and asserting in
  the DB, with the embedder installed only in the launch that takes a
  turn. A spec can't seed an unfinished run row: boot recovery takes it
  at launch. That case is the unit test's.
- **Mutation check.** Most likely to pass vacuously, break each once:
  - the run-row delete (the `branches` delete must then fail on the
    foreign key), the re-parent, and the story join in the count;
  - the hold-free gate read (the held-current-branch case) and the DB
    swap read (the case where `currentStoryStore` holds another story);
  - the remap of `parent_branch_id` and each new record in
    `dropBranchRecords`;
  - the chapter-number re-read (the E2E's card label);
  - the chip's latch: with it removed, the delete E2E's "the chip still
    shows 2" must fail;
  - the toast's focus check and its dismissal on blur, each against its
    own case in the hook's test.

## Open questions

Each has a default this doc builds on. Slice planning confirms it, and a
change amends the scope above.

- **Size.** Planned at 19. If the plan skeleton passes 20, the slice
  splits in two: branch delete (the records, the lint, the count, the
  action, the confirm, the reader's wiring and its E2E) and story
  duplicate (the refusals, the action, the dialog, the list's wiring, its
  E2E and the cost). The redo map stays in 6.2 either way. Both halves
  still land after 6.1, 6.2 and 6.4.
- **Unaudited.** The milestone's
  [list](../milestone.md#open-questions) names, among what no audit
  rechecked: this slice's refusal under the gate and its canon edit; C7's
  seed turns, which the delete E2E's non-zero count rests on; and C8's
  refresh order, which this slice's step 4 follows. Slice planning reads
  the first against `generation.ts:89-93` and whatever the batched pass
  wrote, and the other two against what 6.3 and 6.4 shipped.
- **The refusal line for an unfinished run.** Canon's Refused paragraph
  names a pending embedder change, a branch held by an unrecovered memory
  update, or a run still going. An unfinished row of another kind, a
  per-turn orphan for one, is none of these. Default: one line for
  `branch-held` and `unfinished-run`, that a branch being copied has an
  interrupted update the app hasn't recovered, and that restarting the
  app retries it; canon's paragraph gains it.
- **A source changing mid-duplicate.** The branch list and the vec
  family list are read before the batch. A source branch deleted in that
  gap is left out if it was a leaf, and fails the batch on the remapped
  parent's foreign key if it wasn't; a branch forked in the gap is left
  out. Nothing partial lands either way, and neither race is reachable
  from the UI: the story list and the navigator never take input
  together. Default: accept, with the test above. A vec family created in
  the gap is missed, which C3 accepts.
- **The group the duplicate E2E undoes.** The seeded hero story's newest
  group may be one the reader confirms before undoing. Default: the spec
  makes a prose edit on the source through the reader first, so the
  copy's newest group is a `user_edit` the reader undoes directly, and the
  assertion is the edited entry's text on each side.
- **The swap helper's home.** Default: an exported DB read in
  `lib/embedder-swap`, beside `isStorySwapPending`, which keeps its
  callers.
- **The Popover under the confirm on web.** Radix keeps a lower layer
  from dismissing while a modal sits above it, and the lockfile holds one
  copy of `@radix-ui/react-dismissable-layer` (1.1.11), so the navigator
  should stay open under the confirm. Unverified; the delete E2E's "the
  navigator stays open" checks it on desktop.
- **`branchQueues`** (`lib/actions/turns/branch-queue.ts:16`) never
  prunes, so a deleted branch's settled entry stays. A deleted branch's
  id can't come back, which is what the lesson guards against. Default:
  leave it.
- **Run rows with no branch.** 6.1's backfill stamps only unfinished run
  rows, so finished rows written before 6.1 keep a null `branch_id`.
  Step 3's delete by branch can't find them: a deleted branch's old
  finished rows outlive it, until `deleteStory`'s story-wide delete
  (`lib/actions/stories/delete-story.ts:76`). Nothing reads a finished
  row (recovery reads unfinished ones,
  `lib/pipeline/runtime/recovery.ts:59-63`), a null foreign key isn't
  checked, so the `branches` delete still
  succeeds, and boot recovery settles an unfinished null row before any
  delete can run. Default: leave them. R1 has branch delete remove the
  branch's run rows, and these name no branch; its canon pass should say
  so.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved
developer decisions._
