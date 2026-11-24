# Implementation triage

Inbox for cross-cutting deferrals surfaced during implementation that
have **no single downstream slice to own them** — the items that would
otherwise be dropped straight into [`followups.md`](../followups.md) or
[`parked.md`](../parked.md) and lost.

Drop them here first. This file is a **queue, not a ledger**: an item
living here means "not yet triaged," not "deferred forever." Triage
happens as a separate pass — each item is read, then routed to its real
home (a specific slice's Open questions, the active
[`followups.md`](../followups.md) ledger, [`parked.md`](../parked.md), a
canonical spec change) or deleted if it dissolves on inspection. Keep
the queue short; a growing inbox is the signal to triage.

A deferral that a **specific downstream slice** will own does not belong
here — it goes straight into that slice's Open questions, where the
slice-planning gate forces its resolution before that slice is planned.

## Inbox

- **Story isolation leaks across files under
  `--fileParallelism=false`.** Serializing puts every story file in one
  page, and some app-level DOM state survives the file that set it.
  Latent rather than active — nothing runs the suite serially — but it
  means "run the browser project sequentially" is not available as a
  debugging move, which is exactly the move a browser-project
  regression calls for. See
  [failed Storybook files with zero failed tests](lessons-learned/storybook-load-flake-zero-failed-tests.md)
  for the parallel-run flake this sits next to; the two may share a
  cause. **Anchor item — accumulating evidence, not yet actionable.**
  Append observations rather than rewriting.

  Evidence so far:
  - 2026-08-24, raised at `384823d6`: the `Diagnostics On` story in
    `app-actions-menu-pure.stories.tsx` failed 2/2, body carrying a
    `data-density` attribute. Attributed to that story; both the
    attribution and the mechanism are unconfirmed.
  - 2026-08-25 at `edce17b8`, three full serial runs (96 files, 803
    tests): green, then a failure in `Trigger Opens Overlay`
    (`preset-browser.stories.tsx`), then green. `Diagnostics On` passed
    all three; `components/compounds` alone is green 26/26. So it is
    intermittent (~1 in 3), the failing story varies across
    directories, and it is not one story's dependency. Root cause
    unidentified — an overlay that fails to open suggests residual
    pointer-events or portal state rather than `data-density`, which
    every file sets for itself through the global decorator in
    `.storybook/preview.tsx`.
  - 2026-10-07, 4.5a: `Trigger Opens Overlay`
    (`preset-browser.stories.tsx:49`) failed once in a 27-file parallel
    run, on `findByText`'s 1 s default, and passed 3 of 3 alone.
  - 2026-10-25, the 2026-10-24 triage pass: `Trigger Opens Overlay`
    failed once in a full parallel Storybook run (145 files) at a
    commit whose `components/wizard/` matched main's, and passed 3 of
    3 alone. The other two full runs that day were green.

  **Revisit trigger.** A browser-project regression that a parallel run
  cannot localise. That is the moment the missing debugging move costs
  something, and the moment a fourth serial run is worth what it takes
  to get. Held rather than routed in the 2026-09-09 triage pass, which
  did not re-run the suite serially — the evidence above is still as of
  `edce17b8`.

- **The story card's `⋯` is a Popover on every tier.**
  [`story-list.md → Mobile expression`](../ui/screens/story-list/story-list.md#mobile-expression)
  binds it to a short Sheet on phone, and
  `components/story/story-card.tsx:189-238` renders a Popover
  everywhere. It predates M6: found by M6's planning research
  (2026-11-22), since `⋯` is Duplicate's entry point, and left out of
  Slice 6.6. Read at the component, not run on a phone tier.

- **`probe_captures`' ER note says it is the only table not copied on
  fork.** `docs/data-model.md:255` calls it "the only such table", but
  the Branch-copy manifest skips `pipeline_runs` too (both copies), so
  the note has been stale since that row landed. Found by M6.1's final
  review (2026-11-22); pre-existing canon, outside that slice's scope.

- **The rollback's create-delta lookup still hedges on `entry_id`.**
  `lib/actions/story-entries/operational.ts:255-256` says the lookup by
  `target_id` works "whether or not foreground deltas stamp entry_id".
  M6.1's anchor settled that: the `user_action` create is stamped with
  its entry (`lib/actions/turns/submit-turn.ts:180`), so the hedge reads
  as an open question it no longer is. Found by M6.1's final review
  (2026-11-22).

- **The vec0 shadow-table list is incomplete.**
  `lib/db/embeddings/vec-tables.ts:16-18` names four shadow tables;
  sqlite-vec 0.1.9 with metadata and auxiliary columns also creates
  `_auxiliary`, `_metadatachunks00/01` and `_metadatatext00/01`
  (checked on a scratch `vec0` table with the families' column shape).
  The exact-name regex still holds, so only the comment misleads. Its
  stated reason is off too: the shadow tables reject DML only under
  SQLite's defensive flag (`node:sqlite`'s default), and
  `_vector_chunks00` accepts a `DELETE` even then;
  `lib/actions/stories/delete-story.test.ts:354`'s test name repeats it.
  Found by M6.1's final review and its slice review (2026-11-22).

- **Two close-agent test comments cite "(5.9)" as future work.**
  `lib/pipeline/definitions/close-agent/lore-tools.test.ts:295` and
  `lib/pipeline/definitions/close-agent/write-path.test.ts:1067` say "as
  read_turns will show one (5.9)". Slice 5.9 has shipped (`read_turns`
  is in `close-agent/read-turns.ts`, merged in #735), so the pointer is
  stale per `.claude/rules/code.md`'s commenting discipline. Found by
  M6.1's final review (2026-11-22).

- **Two vec0 comments say a `pk IN` read answers no rows.**
  `lib/db/embeddings/knn.ts:63-65` and `lib/db/embeddings/ops.ts:75-76`
  say vec0 answers `pk IN (…)` with zero rows, and
  [Slice 6.1](milestones/06-branches-diff-cache/slices/01-copy-substrate.md)
  repeats it in its Scope. On sqlite-vec 0.1.9 under `node:sqlite`,
  desktop's version, every `pk` predicate answers correctly: `=`, `IN`,
  `IN (SELECT …)`, `LIKE`, and a `DELETE … pk IN`. Android's
  v0.1.7-alpha.2 is unchecked. The code reads by `branch_id` and `id`
  either way, so only the comments' stated reason may be stale. Found by
  M6.1's slice review (2026-11-22).

- **A desktop crash mid-migration can leave the database unable to
  boot.** Desktop's runner applies a migration's statements one by one
  with no wrapping transaction (`electron/db/service.ts:97-100`).
  Killed partway through a table rebuild (`0003`, `0009`, `0016` and
  `0021` rebuild), the next boot re-runs the step from its start and
  fails: after the `CREATE` or the `DROP`, on "table `__new_deltas`
  already exists"; after `0021`'s closing `ALTER`, before drizzle records
  the step, on "duplicate column name: branch_id". Android runs every
  pending migration in one transaction and rolls back. The relaunch that
  could cause such a kill is parked as
  [A relaunch kills a primary whose main thread stalls](../parked.md#a-relaunch-kills-a-primary-whose-main-thread-stalls);
  this is what the kill leaves behind. Found by M6.1's slice review
  (2026-11-22), probed on `node:sqlite`.

- **Test plumbing the M6.1 simplifier left duplicated.** Three test
  files hand-roll `BEGIN` / `COMMIT` / `ROLLBACK` on a raw
  `DatabaseSync`: `lib/db/branch-copy/vec-copy.test.ts:92`
  (`runInTransaction`, "As createTestDb's"),
  `lib/db/__tests__/migrate-m6-deltas-key.test.ts:38`
  (`migrateLikeAndroid`, which models expo's runner and may need to stay
  apart) and `lib/db/__tests__/two-branch.ts:91` (`cloneBranch`). A
  shared helper would live in `lib/db/__tests__/test-db.ts`, outside that
  slice. Separately, `lib/actions/story-entries/scene-fields.test.ts:248`
  and `:315` spell out the call its `removeCast` helper makes (`:216`).
  No defect either way. Found by M6.1's slice review (2026-11-22).

- **No test passes a wrong branch to a scoped store read.** Every
  working-set read now names its branch, so the typecheck blocks a
  return to an unscoped call. It does not block
  `x(store.getLoadedBranch())`, which compiles and reads like the old
  unscoped call, and only a case with rows on two branches would catch
  it. The sites no such case covers yet, each taking its branch from a
  caller or the open story: `lib/actions/world/resolve-collision.ts:158-162`,
  `lib/actions/world/save-entity.ts:28`,
  `components/reader/peek/use-peek-view.ts:43-44`,
  `components/reader/use-reader-slice.ts:65`,
  `components/reader/use-entry-jump.ts:190`,
  `components/reader/use-reader-undo.tsx:75` and `:184`,
  `components/chapters/chapter-overlays-host.tsx:90`,
  `hooks/use-row-signals.ts:67-76`, and `freshDeleteTarget`'s reads in
  `components/world/use-world-delete.ts:69-70` and
  `components/plot/use-plot-delete.ts:104-105`, which each survived a
  swap to `getLoadedBranch()` in the slice review. Cheapest first pin:
  an awareness row on `br_2` in the peek-view case. Found by Slice
  6.2's third-PR review (2026-11-23); the list re-checked by its slice
  review (2026-11-23).

- **`raiseSystemEntry` repeats the working-set factory's patch guard.**
  `lib/actions/story-entries/system-entry.ts:85` returns early when the
  store holds another branch, and the factory's `patch`
  (`lib/stores/factory/working-set-store.ts:52`) already drops a branch
  the store doesn't hold. In `system-entry.test.ts`, "leaves the store
  alone when it holds another branch" fails only with both guards
  removed; removing either alone passes (mutation-checked 2026-11-23).
  The factory guard stays, since every writer relies on it; `:85` also
  skips a database read. So the choice is dropping `:85` and accepting
  the wasted read, or pinning it with a case that spies on that read.
  It predates Slice 6.2's third PR. Found by that PR's review
  (2026-11-23).

- **A story delete can race an undo in flight.** `deleteStory`
  (`lib/actions/stories/delete-story.ts`) takes no guard against a
  reversal in flight. A delete that commits after an undo built its
  plan and before the undo commits lets the undo report `ok` and push
  its redo group for a branch that no longer exists: probed with a
  wrapped `runInTransaction`, `undoRedoStore.__branches()` held the
  deleted branch (2026-11-23). The reversal itself then commits
  against the deleted story; for a delete's undo it would re-insert
  rows into the dead branch (inferred, not probed). Whether the UI can
  reach the window, the undo's own read-to-commit stretch, is unshown.
  It predates Slice 6.2. Found by Slice 6.2's slice review
  (2026-11-23).

- **Can a pipeline reversal leave a redo group that contradicts its
  branch?** Every delta-logged write clears its branch's redo stack,
  but the pipeline's reversals clear none: `reverseCloseForRerun`
  (`lib/pipeline/definitions/chapter-close-reversal.ts`) and a run
  abort's `reverseRunGroup` / `reverseReplayDeltas`. A review agent
  reasoned, without a probe, that an aborted re-run whose journal
  write-back ends `undone` changes the branch while a redo group pushed
  before the re-run stays, so the redo could restore rows the reversal
  removed. Verify the sequence before fixing anything. It predates
  Slice 6.2. Found by Slice 6.2's slice review (2026-11-23).

- **Unit tests run hooks without React Compiler.** The app builds with
  the compiler (`app.json` → `expo.experiments.reactCompiler`), but
  `vitest.config.ts` doesn't apply it, so a hook whose correctness rests
  on what the compiler memoizes passes vitest either way, and
  `pnpm compiler:check` reports bail-outs, not behaviour. Slice 6.2's
  slice review hit it in `components/reader/use-reader-undo.tsx`: a
  Redo label that ignored the state the menu's open sets stayed green
  uncompiled and went stale compiled (a scratch harness compiled the
  hook with the build's compiler, 2026-11-23). Options: a vitest
  transform that runs the compiler over `components/` and `hooks/`, or
  a small compiled-hook layer for hooks that read stores outside a
  subscription. Found by Slice 6.2's slice review (2026-11-23).

- **The M6 milestone doc names the fork planner by its old canon
  name.** `milestones/06-branches-diff-cache/milestone.md:32` still
  says canon calls the rewind's planner `planReversal` with a target
  branch. Slice 6.3's canon edits renamed both: canon now names
  `buildReverseAndPrunePlan`, given a `PlanTarget` whose
  `writeBranchId` is the new branch. The sentence is planning
  narrative, so the fix is a reword there. Found by Slice 6.3's final
  review (2026-11-24).

- **Unscoped delta reads in E2E can't catch a delta on the wrong
  branch.** `e2e/tests/plot.spec.ts:517` reads
  `deltas WHERE target_id = ?` with no branch scope, so a delete delta
  written to the wrong branch would still pass the exact-equality
  check. The shape predates Slice 6.3, and every unscoped delta read in
  the specs shares it. Found by Slice 6.3's final review (2026-11-24).

- **The seed's fork carries world rows tied to entries it lacks.**
  `br_hero_fork` is `br_hero_main` rolled back to `entry_hero_0040`,
  but the hero seed logs no delta for most world rows, so the rollback
  leaves them as main holds them: the fork keeps "Escape the River
  Keep" failed at `entry_hero_0047`, "Earn Mira's trust" resolved at
  `entry_hero_0050`, and "Vorne's pact" with the two awareness rows
  learned at `entry_hero_0059`, all entries it doesn't hold. A rollback
  on seeded main to the same entry gives the same rows. Slices 6.4, 6.6
  and 6.8 read the fork (C7); a screen resolving such an entry id on
  the fork finds no entry. Options: log the seed's world rows as
  deltas (changes main's undo grouping, which E2E drives), or record
  the shape as the seed's contract. Found by Slice 6.3's slice review

- **A successful story load's open-failure clear is untested.**
  `loadAndPublish` in `lib/actions/stories/operational.ts` calls
  `storiesStore.clearOpenFailure(storyId)` before it publishes;
  deleting the line leaves the three load suites green (28 tests). The
  line predates Slice 6.4, which only moved it. Found by Slice 6.4's
  Task 3 review (2026-11-24).

- **Diagnostics settings show capture off in a dev build that forces it
  on.** The debug switch in
  `components/compounds/diagnostics-settings-panel.tsx:32` is disabled
  on the stored flag, while a dev build forces capture on
  (`lib/boot/bootstrap.ts:39-42`). So the panel reads capture off and
  debug disabled while capture runs, and turning debug on needs capture
  toggled first. Hit on desktop and the slot AVD in Slice 6.4's device
  passes (2026-11-24).

- **Older overlay-list stories log a `ResizeObserver` loop error.** The
  story run of `components/ui/searchable-overlay-list.stories.tsx`
  logs an unhandled "ResizeObserver loop completed with undelivered
  notifications" and still passes; the stories Slice 6.4 added don't
  log it when run alone. Found by Slice 6.4's Task 6 review
  (2026-11-24).

- **A phone Sheet opened over the reader's inline editor lands under
  its keyboard.** Canon says a sheet opened over an open keyboard
  dismisses it first
  ([`overlays.md`](../ui/patterns/overlays.md#sheet--keyboard-handling)),
  and `components/ui/sheet.tsx:390-399` does so through
  `dismissKeyboard()` before `present()`. On the slot AVD (Android 16),
  with an entry's inline editor holding the keyboard, tapping the
  branch chip opened the navigator Sheet under it: its rows sat under
  the keyboard and a tap landed on a key, until Back hid it. With the
  composer's keyboard up the same tap dismissed it as canon says.
  Inferred, not probed: the dismiss doesn't reach the input method of
  the reader's WebView document, so any phone Sheet opened from the
  reader during an inline edit (the chapter chip's too) would do the
  same. Found in Slice 6.4's device pass (2026-11-24).

- **Two reader wireframes drift from the shipped phone chip strip.**
  `branch-navigator.html` draws the phone chip in the top bar (it has
  no chip strip) and overflows at 390 px; in `reader-composer.html`
  (around line 951) the phone strip's branch chip never hides at one
  branch, since `setBranchCount` toggles only `#branch-chip` and its
  separator. Both predate Slice 6.4's edit. Found by Slice 6.4's
  Task 21 review (2026-11-24).

- **`data-model.md` calls the stories row the only user-authored
  content outside the log.** `docs/data-model.md:3274-3276`; a branch
  name is a counterexample, and canon now says rename is an unlogged
  write
  ([`branch-navigator.md`](../ui/screens/reader-composer/branch-navigator/branch-navigator.md#inline-rename)).
  Found by Slice 6.4's Task 21 review (2026-11-24).

- **A second `beforeRemove` preventer replays its action and the arm
  registry doesn't see it.** `hooks/use-story-leave-guard.ts:60-64`
  keeps `data.action` and replays it on "Cancel & leave", and
  `isUnsavedPopArmed` doesn't cover it. A switch's stack reset could be
  swallowed by it only if a run started on the story between the
  switch's gate check and its reset: unreachable today, since every
  pipeline is `hard-gate` and `switchBranch` also refuses on
  `isStoryBusy`. Pre-existing. Found by Slice 6.4's reviews
  (2026-11-24).
