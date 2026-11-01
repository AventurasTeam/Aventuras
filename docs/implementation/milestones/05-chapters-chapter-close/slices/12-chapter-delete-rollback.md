# Slice 5.12 — Chapter delete and rollback

## Metadata

- **Milestone:** [Milestone 5 — Chapters + chapter-close](../milestone.md)
- **Depends on:** [Slice 5.2](./02-first-chapter.md) (a close group to
  reverse, C1, C10), [Slice 5.5a](./05a-task-runner.md) (the round-trip
  suite, C9, and the retrieval-only export),
  [Slice 5.6](./06-close-owed.md) (a close that chains, runs and is
  interrupted, and `pendingClose`'s lifecycle),
  [Slice 5.7](./07-chapter-timeline.md) (the card hosting `Delete…`, C16).
  C5 arrives through 5.6 and 5.7.
- **Blocks:** none

## Goal

A chapter can be deleted without touching its entries, whole or as the
divider alone, and rollback and regenerate tell the truth about chapters.
This delivers the `removeChapter` action and its confirm, later-write
yielding in the reversal, regenerate's close arm, rollback's chapter
copy, and counts that leave out a run the confirm is about to interrupt.

## Background

Deleting a chapter isn't a rollback: it's CTRL-Z of the close, still
available after later turns, on the latest chapter only, and no entry
goes. That makes it the one reversal with turns above its group, so the
shipped yield to `user_edit` isn't enough and a field has to yield to any
later writer. Rollback itself needs no reversal change: its modal,
counts and `counts-changed` shipped in M2.5, and what's missing is honest
chapter copy. The regenerate gate's chapter arm has been dormant since
M3, and the route drops its classification. Both confirms also count a
running close's writes, so a confirm can misfire, and a commit can refuse
a difference its own interrupt made.

## Required reading

- [`chapter-close.md → Deleting a chapter`](../../../../memory/chapter-close.md#deleting-a-chapter),
  [`Logs and anchors`](../../../../memory/chapter-close.md#logs-and-anchors),
  [`Manual user-triggered close`](../../../../memory/chapter-close.md#manual-user-triggered-close)
  and
  [`Failure modes and atomic rollback`](../../../../memory/chapter-close.md#failure-modes-and-atomic-rollback)
- [`chapter-timeline.md → Delete a chapter`](../../../../ui/screens/chapter-timeline/chapter-timeline.md#delete-a-chapter)
  and
  [`Per-card actions`](../../../../ui/screens/chapter-timeline/chapter-timeline.md#per-card-actions)
- [`generation-pipeline.md → Reverse-replay`](../../../../generation-pipeline.md#reverse-replay),
  from "A reversed machine write keeps a later user write" through "A
  chapter delete keeps later writes from any source"
- [`generation-pipeline.md → Prose reversals and the interrupt`](../../../../generation-pipeline.md#prose-reversals-and-the-interrupt)
  and
  [`Branch write lock`](../../../../generation-pipeline.md#branch-write-lock)
- [`data-model.md → Entry mutability & rollback`](../../../../data-model.md#entry-mutability--rollback)
  and [`Survival anchor`](../../../../data-model.md#survival-anchor)
- [`rollback-confirm.md → Confirmation modal`](../../../../ui/screens/reader-composer/rollback-confirm/rollback-confirm.md#confirmation-modal--post-click),
  [`Counts`](../../../../ui/screens/reader-composer/rollback-confirm/rollback-confirm.md#counts),
  [`Cross-chapter case`](../../../../ui/screens/reader-composer/rollback-confirm/rollback-confirm.md#cross-chapter-case),
  [`What the modal deliberately does NOT surface`](../../../../ui/screens/reader-composer/rollback-confirm/rollback-confirm.md#what-the-modal-deliberately-does-not-surface)
  and
  [`Edge cases`](../../../../ui/screens/reader-composer/rollback-confirm/rollback-confirm.md#edge-cases)
- [`reader-composer.md → Regenerate confirmation`](../../../../ui/screens/reader-composer/reader-composer.md#regenerate-confirmation)
  and
  [`During a memory update`](../../../../ui/screens/reader-composer/reader-composer.md#during-a-memory-update)
- [`principles.md → Edit restrictions during in-flight generation`](../../../../ui/principles.md#edit-restrictions-during-in-flight-generation)
- [`alert-dialog.md → Copy contract`](../../../../ui/patterns/alert-dialog.md#copy-contract),
  which the delete confirm departs from on purpose
- [`testing.md → Coverage`](../../../../testing.md#coverage-thorough-not-exhaustive)
  and
  [`Fixture + seed contract`](../../../../testing.md#fixture--seed-contract)
- [`milestone.md → C13`](../milestone.md#c13--chapter-delete), which this
  slice provides
- [`C1`](../milestone.md#c1--a-closes-delta-shape),
  [`C5`](../milestone.md#c5--token-reads-and-the-progress-hook),
  [`C8`](../milestone.md#c8--seed-stability),
  [`C9`](../milestone.md#c9--the-round-trip-rule),
  [`C10`](../milestone.md#c10--what-a-chapter-may-end-on),
  [`C14`](../milestone.md#c14--the-manual-start-and-pendingclose) and
  [`C16`](../milestone.md#c16--flip-rule), which it consumes
- Lessons:
  [No harmless id leaks](../../../lessons-learned/no-harmless-id-leaks.md),
  [The seeded branch tip moves at the first Send](../../../lessons-learned/seed-tip-position-shifts-at-first-send.md)

## Scope: in

**The action (C13).** `lib/actions/chapters/remove-chapter.ts`, exported
through `lib/actions/index.ts`:

- `removeChapter(branchId, chapterId, mode, ctx)`, with `mode` either
  `'whole'` or `'divider-only'`: C13's one action, in this order.
  1. Refuse `in-flight` on `generationStore.isUserEditBlocked()`, with no
     `await` before `bracketProseReversal`, so a second press is refused
     rather than thrown as re-entry
     (`lib/actions/story-entries/operational.ts:75-79` makes the same
     point). Every read below sits inside the bracket.
  2. Refuse `not-found` on a gone row, and `not-latest` when the chapter
     isn't the branch's highest `sequence_number`.
  3. Read the chapter's `create` delta by `branch_id`, `target_table`,
     `target_id` and `op`, and refuse `no-close` when there is none. Read
     the group by `branch_id` and that delta's `action_id`, newest first.
  4. Seed the set. `'whole'` takes the group. `'divider-only'` takes the
     group's rows on `chapters` and `story_entries`: a close writes no
     entries, so those are the chapter row, its report and its stamps
     (C1).
  5. Call `selectReversalSet(ctx, { branchId, target, yieldTo: 'any' })`,
     then `commitNewAction(set, ctx, [])`. There's no clamp, since no
     entry goes and a close never moves the watermark. A
     `ReversalIntegrityError` returns `integrity` through
     `logReversalRefused`.
- `getChapterDeletePreview(branchId, chapterId, story, ctx)`, under
  `withBranchWriteShared` as `getRollbackCounts` is, with the same
  refusals and the same set. It takes `story` as `closeOwed` does.
- `commitNewAction` (`operational.ts:45-57`) gains `export`. It stays out
  of the module's index: `regenerate-turn.ts` imports its siblings the
  same way.

**Later writes win (C13).**

- `ReversalSeed` gains `yieldTo?: 'user' | 'any'`, default `'user'`, and
  the nominal `ReversalSet` carries it, including the empty set at
  `lib/actions/delta/row-closure.ts:407-414`. Every other caller stays on
  the default and behaves as it does today.
- `userEditsOutliving` (`lib/actions/delta/user-precedence.ts:103-127`)
  takes the mode. With `'any'` it reads every source and drops
  `retrievalCount`-only updates, using the test 5.5a exported from
  `lib/row-signals`. `refClearsOf` (`row-closure.ts:358`) and
  `buildUndoOps` (`lib/actions/delta/reverse-replay.ts:664`) both read
  the mode, so the walk and the ref clears can't disagree: a yield in the
  walk alone would still unplace a place a later write had moved.
- **Only field restores widen.** `undoUpdate` and `restoredRefs` read the
  widened edits. `undoCreate`, `undoHeldCreate` and `userKeptRows` keep
  reading `user_edit` alone. `buildUndoOps` hands one map to all three
  arms today (`:664-672`), and a widened map there would let a later
  machine write re-own a create. Only `character_relationships` has
  `rowKeepingColumns` and no close writes it, so nothing fails yet; a test
  holds it.
- **Stackables,** only if [Slice 5.9](./09-chapter-wide-tasks.md) lands
  first. Its guard reads the edits the walk holds, so the widened map
  meets C13's rule with no code here, and this slice adds the arm to the
  suite. If 5.12 lands first, 5.9 adds it.

**The confirm.** `components/chapters/chapter-delete-confirm.tsx`, an
AlertDialog per canon, props in with no store reads, so stories run
without a database. Copy goes in the `chapters` namespace 5.7 creates.

- **Preview.** `getChapterDeletePreview` returns:
  - `createdLore`: the `lore` creates in the group, with
    `, your edits included` shown only when a `user_edit` delta on one of
    those rows is in the set.
  - `otherChanges`: `set.rows` less the stamps, the `chapters` rows, the
    lore creates and `retrievalCount`-only updates, plus
    `set.refClears.length`, as `rollbackCountsOf` counts a clear. A delta
    whose every field yields still counts, since telling needs the
    planner; the number is a slight overstatement in that rare case.
  - `turnsSince`: the `ai_reply` rows in `openRegionSeries`.
  - `after`, below.
- **The after-delete line.** A pure `closeAfterDelete` in `lib/chapters`
  takes `{ tokensAfter, threshold, autoClose, manualPending }` and returns
  `'closes-next-send'`, `'waits'` or `'stays-open'`.
  - `tokensAfter` is the region's sum plus `content_tokens` over the
    chapter's own non-`system` entries. It isn't `chapters.token_count`,
    which [Slice 5.1](./01-token-measure.md) leaves as a snapshot.
  - `threshold` and `autoClose` come from `story`'s settings, with `>=`
    as `closeOwed` compares.
  - `manualPending` is `pendingClose.has(branchId)`, C13's first case:
    `closeOwed` owes it whatever the tokens, so it takes the first result
    ahead of the threshold.
  - The region after a delete always holds the end reply, so C10's reply
    condition needs no check.
- **Copy.** Title `Delete chapter <N>?`, body and lines per canon. A count
  line at zero is left out, as rollback's chapter line is, since a close
  can land with no agent writes. The third line gains a second sentence,
  `Undoing one can bring back a value this removes.`, because C13 says the
  confirm states that residue and canon's layout doesn't. With
  `closes-next-send`, one more line:
  `Removing only the divider closes the same prose again, on top of the kept work.`
- **Buttons.** `Cancel`, `Remove divider only` (`secondary`) and
  `Delete chapter` (destructive). Both actions disable while the gate is
  closed.
- **Staying true.** `useChapterDeleteConfirm` in `components/chapters/`
  holds the open chapter and its preview, and re-reads the preview when
  `settleCount` moves, as `useLiveRollbackCounts` does. A refused re-read
  closes the confirm with the refusal's toast.

**The card (C16).**

- `Delete…` flips from disabled with its reason to opening the confirm, in
  the action row and in the phone's `OverflowMenu` entry alike. The route
  holds the confirm's state, so `ChapterCard` stays props-only.
- It goes through the route's `guard`, so a dirty card raises
  `Unsaved changes` first: a draft on a row about to go has nowhere to
  land. 5.7's list of guarded transitions leaves it out only because it
  ships disabled.
- A refused preview toasts and opens nothing, as `openRollback` does at
  `app/reader-composer/[branchId].tsx:1112-1115`.
- A refusal toasts and closes the confirm, since what it showed has moved:
  `not-latest` reads `This is no longer the latest chapter.`, and the
  others a failure. A success toasts nothing: the card goes, and 5.7's
  `nextExpandedChapter` drops its id.

**The round-trip suite (C9).** Both modes join as arms in
`lib/pipeline/__tests__/close-round-trip.test.ts`. Arms are data, so every
tool on main runs them, and a tool landing later does by joining the
table.

**Removing `deleteChapter`.** The action kind and handler
(`lib/actions/chapters/register.ts:31,150-170,180`), its `LOCK_KEY` entry
(`lib/actions/delta/apply-delta-action.ts:93`), the arm at
`lib/actions/delta/delete-arms.test.ts:101` and the case at
`lib/actions/chapters/register.test.ts:183`. `cascade` and `cascadedDelete`
go from `register.ts` too, since only a delete reads a cascade.

**Regenerate's close arm.**

- `RollbackCounts` (`operational.ts:228`) gains three fields:
  - `closeWrites: number`, compared by `sameRollbackCounts`.
  - `reopenedChapter: number | null`, the `sequence_number` of the chapter
    the target falls inside.
  - `removedChapters: number[]`, those whose every entry goes, oldest
    first. Neither chapter field needs comparing: for one target, the same
    `chapters` count means the same chapters.
- `resolveSweep` (`operational.ts:301-321`) returns, beside `set` and
  `clampOps`:
  - `closeWrites`, from `rows`, the window before the closure: rows with
    `source = 'chapter_close'`, skipping the running run's action and
    `retrievalCount`-only updates. From the window, because the closure
    adds a close's reset on a row a later turn created, for a chapter that
    stands. Skipping resets, because a close's work reduced to counters is
    nothing a user would consent to.
  - the running run's `actionId`, from
    `selectMemoryRun(generationStore.getTxState(), { branchId })`.
  - the target's position.
- `rollbackCountsOf` takes that result and becomes async, since a chapter's
  fate reads `start_entry_id`'s position: below the target it re-opens,
  otherwise it goes. It skips the running run's rows in every bucket and
  leaves the set alone. `undo.ts` doesn't call it, so CTRL-Z pays nothing.
  Its three callers are `getRollbackCounts`, `rollbackToEntry` and
  `sweepFrom`. It also skips `retrievalCount`-only updates in K, the
  default under [Open questions](#open-questions).
- The preview takes that read inside the shared section. `getRollbackCounts`
  calls `rollbackCountsOf` after releasing `withBranchWriteShared` today
  (`operational.ts:359-363`), and a CTRL-Z landing between the two would give
  `chapters: 1` with neither chapter line. Both calls move inside the hold.
- `classifyRegenerateGate` (`components/reader/regenerate-gate.ts:35-38`):

  ```ts
  if (counts.entries > 1) return 'cascade-confirm'
  if (counts.chapters > 0 || counts.closeWrites > 0) return 'chapter-close-confirm'
  return 'immediate'
  ```

  With one entry in range, a chapter in range ends on that reply, which is
  canon's arm. C10 keeps a close off a `user_action`, so a failed
  regenerate's follow-up sweep of the action can't take one unasked.

- **The confirm's kind is derived, never stored.** `ConfirmState.mode` keeps
  its two values. `RollbackConfirmModal` reads `classifyRegenerateGate(counts)`
  at render, so a live recount can't leave it stale. `immediate` at render
  uses the cascade copy: the confirm is already open.
- **The route.** `:1208` stays the branch point. `:1211` passes `counts`, so
  a close committing as the interrupt lands can't be reversed unconfirmed.
  A `counts-changed` there opens the confirm on the fresh counts, through a
  pure helper beside `reopenAfterRefusal`, without the toast `runRegenerate`
  raises at `:901`: `The counts changed while this was open` has nothing
  open to refer to. The comments at `:1222-1223` and
  `regenerate-gate.ts:33-34` go.
- **Copy,** in `reader.json`:
  - `chapter-close-confirm` with `chapters > 0`: body
    `This discards entry <N> and reverses the chapter close that ends on it, then generates a new reply from your last action. The following are removed:`,
    a bold `Chapter <n> will return to in-progress.`, and
    `Its close runs again only when one is next due, or when you start it.`
    `<n>` is `reopenedChapter`, else the one removed chapter.
  - `chapter-close-confirm` with `chapters = 0`: body
    `This discards entry <N> and the work a removed chapter's close left on it, then generates a new reply from your last action. No close brings that work back. The following are removed:`
  - `cascade-confirm` keeps its body and takes rollback's chapter lines.

**Rollback's copy.** `RollbackConfirmModal` replaces the one chapter line
with two, each bold and each omitted when empty:

- `1 chapter re-opened — chapter <n> will return to in-progress`, from
  `reopenedChapter`.
- `1 chapter removed — chapter <n> goes with its entries`, or
  `<count> chapters removed — chapters <list> go with their entries`, from
  `removedChapters`. `<list>` reads `5 and 6`, and `5–7` from three up,
  from a pure label helper. The numbers are consecutive, since only the
  latest chapter can be deleted.

**Canon, in the same commits.**

- `rollback-confirm.md`: the sketch and the chapter row of `Counts`;
  `Cross-chapter case` for the two lines; `Counts` and `Edge cases` for a
  running run's rows and retrieval-only updates; the
  `CTRL-Z reversibility` bullet at `:138-144`, which contradicts `:72-74`,
  since a rollback can't be undone; and the `Multi-chapter copy` open
  question, which closes.
- `rollback-confirm.html`: the chapter rows.
- `reader-composer.md → Regenerate confirmation`: the re-run sentence, and
  an arm for an older reply with a close in its cascade.
- `chapter-close.md → Manual user-triggered close`: "confirms first that the
  close will re-run". `chapter-close.md → Failure modes and atomic rollback`:
  the default under [Open questions](#open-questions).
- `generation-pipeline.md → Branch write lock`: a preview leaves a running
  run's rows out.
- `chapter-timeline.md → Delete a chapter` and `chapter-timeline.html`: the
  third line's second sentence and the divider line. That section and
  `chapter-close.md → Deleting a chapter` gain C13's pending manual close, which
  neither names.
- `component-inventory.md`: a shipped row for `ChapterDeleteConfirm`.
- `docs/observability.md`: any new event name.

## Scope: out

- Any change to `lib/actions/delta/` for rollback itself. C13's yield is
  the only reversal change here.
- Moving the rollback host out of the reader: chapter delete doesn't use
  it.
- CTRL-Z of a committed close, its redo, and rollback on each side of the
  end entry: proved by [Slice 5.2](./02-first-chapter.md).
- CTRL-Z skipping a running close at `undo.ts:66`, `closeOwed`, Send's close
  after a delete, and `pendingClose`'s lifecycle:
  [Slice 5.6](./06-close-owed.md).
- The Timeline, its cards, the session and `nextExpandedChapter`:
  [Slice 5.7](./07-chapter-timeline.md).
- `updateThread` and `updateHappening` dropping unchanged columns, which
  any-source yielding relies on: [Slice 5.5b](./05b-identity-threads.md).
- The stackable normalizer and its guard:
  [Slice 5.9](./09-chapter-wide-tasks.md).
- `Ready to close` and `Close chapter…`:
  [Slice 5.10](./10-two-starts.md).
- `Review changes`, and the review window closing when its chapter goes:
  [Slice 5.11](./11-review-window.md). Its host's rule already covers both
  modes.
- `Regenerate summary` (M7.2) and fork over a close's deltas (M6.1).

## Acceptance criteria

**Chapter delete.**

- `lib/actions/chapters/remove-chapter.test.ts`, `'whole'`, on a close group
  built as `close-reversal.test.ts` builds one, with a lore create, an entity
  update and a merged row: the chapter row, report and stamps are gone, the
  lore row is gone, the entity field and merged row are back,
  `story_entries` keeps its count and every `content`, `chapter_id` is null
  across the range, and no delta of the group remains.
- The same file, `'divider-only'`: the row, report and stamps reverse; every
  other delta keeps its `action_id`, `source` and `entry_id`, and its write
  stands. With no later turn, `undoLastAction` reverses those writes and
  `redoLastAction` restores them, and `rollbackToEntry` at the end entry
  takes them.
- The same file, refusals, each writing no delta: `in-flight` under a held
  gate, and for a second `removeChapter` issued synchronously with the
  first; `not-latest` on an earlier chapter, and on a chapter a close
  outran after the preview read; `no-close` on a row with no `create` delta.
- The same file: `settleCount` moves by one, `processedThrough` doesn't
  move, and `undoRedoStore` is empty afterwards, including when a mocked
  store sync throws after the commit.
- `e2e/tests/chapter-delete.spec.ts`, on the hero story with
  `seedCloseWrites`: `Delete…` shows on `The Keep Leans Closer` and not on
  `Nine Days of Rain`. `Delete chapter` leaves the `story_entries` count
  unchanged, one `chapters` row, a null `chapter_id` across the range, the
  seeded lore row gone, and the seeded later write's value on the entity. In
  a second launch, `Remove divider only` leaves the lore row in place and the
  group's other deltas anchored on the end entry.

**Later writes win.**

- `remove-chapter.test.ts`, one case per writer, on a field the close wrote:
  a later `user_edit`, a `periodic_classifier` delta anchored past the end
  entry, a `per_turn_classifier` fold write with a null anchor, and a pass
  anchored on the end entry and logged after the close. The later value
  stands in all four.
- The same file: a `state` sub-field yields alone, leaving the close's other
  sub-field to reverse. A `retrievalCount`-only update doesn't hold a field,
  so the reset's undo restores the prior count.
- The same file, a place: P sits under R, the close moves it to Q, a later
  pass moves it to S, and the user deletes R. After the delete P is under S,
  not unplaced.
- The same file: a close-created lore row a later `user_edit` changed still
  goes. After a delete, undoing the later turn writes the close's value
  back, pinning the residue C13 accepts.
- `lib/actions/delta/reverse-replay-user-writes.test.ts`: with `yieldTo: 'any'`
  a later machine write to a `character_relationships` create doesn't keep
  the row. On the default, a later machine write holds no field.
- `lib/pipeline/__tests__/close-round-trip.test.ts`: both modes run as arms
  over every tool on main, and with 5.9 on main a later turn's write to a
  normalized record survives a delete.

**The confirm.**

- `lib/chapters/close-after-delete.test.ts`, with literal numbers: at the
  threshold and one above with auto-close on reads `closes-next-send`; one
  below reads `waits`; auto-close off reads `stays-open` at any size; a
  pending manual close reads `closes-next-send` under the threshold and with
  auto-close off.
- `remove-chapter.test.ts`: the preview returns literal counts for a group
  with two lore creates, one later-edited, excluding stamps, the chapter row
  and resets, and `turnsSince` counts replies only.
- `components/chapters/chapter-delete-confirm.stories.tsx`, play: one story
  per `after` case, one with `turnsSince` 0 showing no third line, one with
  zero writes showing no count lines, and one with no user edit showing no
  `your edits included`. The divider line shows only on `closes-next-send`.
  Each button fires its mode, and both disable in a `Blocked` story.
- `components/chapters/use-chapter-delete-confirm.test.tsx`: a settle re-reads
  the preview, a stale read is dropped, and a refused re-read closes the
  confirm with its toast.
- `e2e/tests/chapter-delete.spec.ts`: with a dirty card, `Delete…` raises
  `Unsaved changes`.

**Regenerate.**

- `components/reader/regenerate-gate.test.ts`, a literal table:
  `{ entries: 1, chapters: 0, closeWrites: 0 }` is `immediate`;
  `{ entries: 1, chapters: 1 }` and
  `{ entries: 1, chapters: 0, closeWrites: 4 }` are `chapter-close-confirm`;
  `{ entries: 3, chapters: 1 }` is `cascade-confirm`.
- `lib/actions/story-entries/operational.test.ts`: a close's kept work at the
  head reads `closeWrites` above 0 with `chapters: 0`; a reset anchored before
  the target, reached only by the closure, leaves `closeWrites` at 0; kept
  work that is only resets reads 0; `sameRollbackCounts` tells counts apart by
  `closeWrites`.
- The same file, a running close at the newest reply with its row, stamps and
  writes in: the preview reads `chapters: 0` and leaves all of them out, and
  the set itself still holds them. A running pass reads the same.
- `lib/actions/turns/regenerate-turn.test.ts`: under a running close the
  counts match after the interrupt and the sweep runs with no
  `counts-changed`; a close that commits as the interrupt lands refuses
  `counts-changed` with its fresh counts on the immediate path.
- `components/reader/confirm-refusal.test.ts`: the immediate arm's refusal
  opens on the fresh counts.
- `components/reader/rollback-confirm.stories.tsx`, play: the regenerate copy
  for each kind, and a recount from cascade counts to chapter counts flipping
  the copy with no change to `ConfirmState`.
- `e2e/tests/chapter-delete.spec.ts`: after a rollback leaves the end reply at
  the head, ↻ on it opens the confirm with the close copy, and confirming
  removes the chapter row and regenerates. After `Remove divider only` and the
  same rollback, ↻ opens the confirm with the kept-work copy, and confirming
  removes the seeded lore row.

**Rollback's copy.**

- `operational.test.ts`: a target inside chapter 2 reads
  `reopenedChapter: 2, removedChapters: []`; chapter 2's start reads
  `null` and `[2]`; a target inside chapter 1 reads `1` and `[2]`.
- `operational.test.ts`: an exclusive hold requested during
  `getRollbackCounts` takes the lock only after the fate read returns, so
  `chapters` always equals `removedChapters.length`, plus one for a
  `reopenedChapter`.
- `rollback-confirm.stories.tsx`, play: one story each for re-opened only,
  removed only, both, and three removed reading `5–7`.
- `e2e/tests/reader-rollback.spec.ts`: on the hero story, a target between
  chapter 2's `start_entry_id` and `end_entry_id`, read from the DB, shows the
  re-opened line, and confirming leaves the earlier entries with a null
  `chapter_id`. Chapter 2's start, then Cancel, shows the removed line.
- `rollback-confirm.md → What the modal deliberately does NOT surface` no
  longer says a rollback is reversible, and `rollback-confirm.html` shows the
  removed line in its cross-chapter state.

**Cleanup.**

- `grep -rn deleteChapter lib app components` finds nothing.
- `grep -n "M5.2" components/reader/regenerate-gate.ts components/reader/regenerate-gate.test.ts`
  finds nothing, and the same for `app/reader-composer/[branchId].tsx`.

**Gates.**

- `pnpm lint`, `pnpm typecheck`, `pnpm lint:docs`, `pnpm format:check`,
  `pnpm compiler:check` and `pnpm test:run` pass, and
  `pnpm test:e2e -- chapter-delete reader-rollback` passes after
  `pnpm build:web`.
- Manual on the Android dev client at phone width: `⋯`, `Delete…`, the confirm
  and both modes on a seeded story. Desktop smoke through the `electron-app`
  MCP.

## Tests

- **Unit, `--project unit`.** `remove-chapter`, `close-after-delete`, the label
  helper, `regenerate-gate`, `operational`, `regenerate-turn`, `confirm-refusal`
  and the delta suites. Every `RollbackCounts` literal gains its fields, in
  `rollback-place-parent.test.ts`, `operational.test.ts`,
  `regenerate-turn.test.ts`, `seed-dataset.test.ts`, `rollback-confirm.stories.tsx`,
  `regenerate-gate.test.ts`, `confirm-refusal.test.ts` and
  `use-live-rollback-counts.test.tsx`. The existing reversal suites stay green
  untouched, which is the proof the default path didn't move.
- **Round trip.** Both modes as arms of the C9 suite.
- **Storybook, browser project.** The delete confirm, and the rollback modal's
  chapter lines and regenerate kinds.
- **E2E.** `e2e/tests/chapter-delete.spec.ts` on the seeded hero story, driving
  the UI and asserting the DB, by chapter title and by ids read from the DB
  (C8). Seeded closes hold little, and `seedCloseWrites` in
  `e2e/harness/seed.ts` adds what this spec asserts, whatever else the group
  holds: a lore create and an entity update in chapter 2's group, anchored on
  its end entry, and a later `periodic_classifier` update of that field, before
  launch, as `seedClassifierBacklog` does. Anchor on the last `ai_reply`, per
  the lesson.
- **Mutation check.** Most likely to pass vacuously: the yield reaching
  `refClearsOf` (remove it and see the place case fail), the bump filter, the
  create arms staying on `user_edit`, `closeWrites` reading the window and not
  the set, and the run skip in each bucket. Break each once. Never derive an
  expected count from the code under test.

## Open questions

Each has a default this doc builds on. Slice planning confirms it, and any
change amends the scope above.

- **Can a regenerate promise the close re-runs?** `reader-composer.md` and
  `chapter-close.md` say it will, and nothing re-marks one: `pendingClose` was
  consumed at the commit, and a reversal removing its entry drops it. After
  regenerating a manual close's end reply, a close follows only with auto-close
  on and the region at the threshold, and boundary selection may pick another
  end. Default: the copy promises nothing, as written above. The sharper option
  reads the region as the delete's confirm does, which adds a read to every
  sweep. Does the developer want it?
- **What does an older reply with a close in its cascade confirm?** Canon has no
  arm, and the shipped gate fires on `chapters > 0`, offering a re-run for a
  chapter whose entries go. Default: `entries > 1` takes the cascade confirm with
  rollback's chapter lines, and canon gains that arm.
- **How do rollback's lines read?** "Re-opened" is true of one chapter at most,
  and "will return to in-progress" is false for any chapter that loses every
  entry. Default: the two lines above, which also close rollback's open question
  on `M > 2`. Is `removed` the right word beside `re-opened`?
- **Is a soft refusal under a running run acceptable?** The skip leaves the set
  alone, and `refClears` carry no action id, so a clear only the run's rows cause
  still reads as a difference and refuses `counts-changed`. The same holds for a
  row another writer touched that only the run's create pulls in. Default: accept
  it, since the confirm re-opens on fresh counts, and a run that commits as the
  interrupt lands should refuse. Filtering clears would add an action id to
  `RefClear` for a rare case.
- **Do count-only updates belong in a consent number?** A close's reset adds one
  to K per row nobody sees change, and a turn's bumps count today too. History and
  row signals already hide them. Default: `rollbackCountsOf` skips them, and
  `rollback-confirm.md → Counts` says so.
- **What residue is accepted?** Three narrow cases. Duplicates after CTRL-Z and
  redo over a manual close at the head, which chapter-close dedup never revisits.
  A head edit under a committed close, which keeps writes derived from the
  replaced prose. A failed reversal under a later close, which a later boot
  reverses, leaving a gap before a closed chapter. All need a manual close or a
  failed transaction. Default: accept all three with no code, and narrow
  `chapter-close.md`'s "a partial close, not broken state" to what it covers,
  since a later boot breaks it.
- **Does 5.9's guard meet C13's stackable rule, if 5.9 lands first?** It reads the
  edits the walk holds, so `undoUpdate`'s widened map should fill it. Default: yes,
  an arm and no code. The later of the two to land confirms it.
- **Is the third line's second sentence the right place for C13's residue?** C13
  says the confirm states it, and canon's layout doesn't. Default: there, since
  the line is omitted exactly when no later turn exists to undo. Does the developer
  accept the longer line?

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
