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

- **A re-run's empty group with no recorded branch fires the log hook
  for `''`.** `lib/actions/delta/rerun-journal.ts:513-517` names the
  reversal set's branch `target[0]?.branchId ?? args.branchId ?? ''`; on
  a restored write-back the post-commit hook then fires for the set's
  branch (`lib/actions/delta/reverse-replay.ts:959`), so an empty group
  with a null `args.branchId` tells the diff cache `''` instead of the
  journal's branch, and that branch's entries survive the write-back.
  It needs a `pipeline_runs.branch_id` that is null, which only rows
  older than that column have (`lib/db/system/system.table.ts:54-55`),
  met at boot recovery (`lib/pipeline/runtime/recovery.ts:73-78`), when
  the cache is still empty. Migration 0022 backfills an unfinished run's
  `branch_id` from its deltas, then its reversal journal, then its
  re-run chapter, so a marker still null has no delta, no journal and no
  chapter row under its ids: the restored write-back can't reach it, and
  the path serves only a dead pre-6.1 marker, at boot, with an empty
  cache. Not reachable in practice today. Found in Slice 6.7's reviews
  (2026-11-23); CodeRabbit raised it on PR #789, kept here
  (provisional, coordinator).

- **The test database collapses same-named result columns.**
  `rowsOf` in `lib/db/__tests__/test-db.ts:35-47` reads row objects and
  maps them with `Object.values`, so two columns of one name collapse
  and an integer-like alias moves first. Electron main's `queryOn`
  (`electron/db/service.ts:52-54`) calls `setReturnArrays(true)` to
  avoid exactly that: `SELECT 1 AS id, 2 AS id, 3 AS "1"` gives
  `[3, 2]` on the test database and `[1, 2, 3]` on main (checked on
  `node:sqlite`, 2026-11-23). A query that only misreads on one of
  them passes its tests. Pre-existing; the new batch callback inherits
  it. Found in Slice 6.7's reviews (2026-11-23).

- **The native boot warn calls M1 the present.**
  `lib/db/runtime/client.native.ts:20` logs "sqlite-vec load failed
  (non-fatal in M1)", describing a shipped milestone as current, which
  `.claude/rules/code.md`'s commenting discipline rules out for
  comments and the same staleness applies to the message. Pre-existing.
  Found in Slice 6.7's reviews (2026-11-23).

- **Does the fork's refusal cover a refused admission's reversal?**
  [Slice 6.1](./milestones/06-branches-diff-cache/slices/01-copy-substrate.md#scope-out)
  kept `reverseReplayDeltas`'s read by `action_id` alone
  (`lib/actions/delta/reverse-replay.ts:986-1002`) on purpose: its one
  caller reverses a live turn's refused admission
  (`lib/actions/turns/submit-turn.ts:196-201`), and canon lets a live
  run select by its id. What's new: a fork copies action ids, and a
  refused admission has no `pipeline_runs` row (its run was never
  reserved), so the fork's refusal of an unfinished run can't see it. A
  fork committed between the turn's `user_action` write and its
  reversal would give the group a second branch, `selectReversalSet`
  would refuse the set (`lib/actions/delta/row-closure.ts:490-494`), and
  the `user_action` entry would stand with no marker for boot to retry.
  The turn's pending mark spans that window
  (`bracketPendingTurn`, `lib/stores/generation/generation.ts:344-371`),
  and Slice 6.3's gate refuses while any turn is pending, which may be
  what covers it; the fork core (Slice 6.3, in flight) answers it.
  [Slice 6.10's Open questions](./milestones/06-branches-diff-cache/slices/10-register-branch-pairs.md#open-questions)
  meet the same refusal from the test-fixture side. Found in Slice 6.7's
  reviews (2026-11-23).

- **Two E2E comments say GO TO World returns to the same World.**
  `e2e/flows/navigation.ts:7-8` and `e2e/tests/world.spec.ts:65-66`
  say the Reader → World GO TO round trip "pops to the World instance
  already on the stack, which keeps its category and selection".
  `hooks/use-surface-navigate.ts:70-73` dismisses down to the Reader on
  GO TO Reader, so World is popped and comes back fresh with nothing
  selected. The callers pick their category either way, so only the
  comments mislead. Pre-existing. Found in Slice 6.7's reviews
  (2026-11-23).

- **A third retrieval-bump predicate with its own shape.**
  `isRetrievalBumpOnly` (`lib/row-signals/link-owners.ts:72-78`) has no
  table check and calls `{}` a bump, beside `isRetrievalBump`
  (`lib/history/link-rows.ts:17-22`) and History's `NOT_RETRIEVAL_BUMP`
  SQL (`lib/history/query.ts:133-137`), which share two constants and a
  test; nothing keeps the third in step. Found in Slice 6.7's reviews
  (2026-11-23).

- **The on-device reseed holds a transaction open across `await`s.**
  `lib/db/devtools/reseed.native.ts:34-40` runs `BEGIN`, then
  `await db.insert(…)` per table, on the app's native connection. Each
  insert is synchronous, but the JS thread yields between them. A read
  in a gap sees rows a `ROLLBACK` may discard, and an app transaction
  there runs `withTransactionSync`, whose `BEGIN` SQLite refuses inside
  an open transaction; its catch then runs `ROLLBACK` (expo-sqlite's
  `SQLiteDatabase.ts:298-307`), ending the reseed's transaction under
  it. The native read's ESLint guard bans async expo-sqlite calls, not
  this. Dev-only: it throws outside `__DEV__`. Found in Slice 6.7's
  reviews (2026-11-23).

- **Change prose can show two sides that read identically.** Three
  cases.
  (1) _Term-list display._ `termListChange` in
  `lib/history/diff-prose.ts:273-281` shows each term through `cutTerm`
  (`:218-224`), which collapses whitespace and keeps a head of 40
  characters; free text gets a window cut around its first difference
  ([Long text](../ui/screens/world/world.md#long-text--change-prose)).
  A tail edit past the 40th character of a long agenda item renders as
  `Agenda: added "Seize control of the harbor district…"` followed by
  `removed "Seize control of the harbor district…"`, the same text
  twice. A respelling between NFD and NFC forms in a normalized list
  renders `Tags: respelled "Eldrá" as "Eldrá"`. Needs a design pass on
  how a term list shows two forms that collide once cut or collapsed.
  (2) _Exact-list write side._ The entity `state` term lists (`traits`,
  `drives`, `agenda`) match exactly
  (`lib/actions/entities/register.ts:401-407`, `termKeyOf` in
  `lib/actions/delta/term-list.ts:9-11`) and store terms with no
  whitespace or Unicode normalization, unlike `keywords` and `tags`,
  which key by `normalizeTerm`. `'brave  heart'` and `'brave heart'`, or
  NFD and NFC forms of one term, are distinct values, so a change
  between them reads `Traits: added "brave heart", removed "brave heart"`
  (the display collapses the spacing). Whether those lists should
  normalize on write, and what that does to existing rows and the delta
  history, is a write-side question, not only display.
  (3) _Namesake refs._ A row ref and a ref list's items (and a place's
  parent and a collision partner) compare by id but read by name
  (`rowRefChange` and `refListChange`,
  `lib/history/diff-prose.ts:332-343`), so two live rows sharing a name
  read alike: `Faction: Iron Pact → Iron Pact`, or
  `Carried: added Rope, removed Rope`. The World panel's keep-as-distinct
  resolution keeps both rows of a name
  ([Collision review](../ui/screens/world/world.md#collision-review-and-entity-merge)).
  The code follows canon literally, a row ref reading the row's name; it
  needs the same design pass as (1).
  Slice 6.7 shipped the prose as `world.md → Change prose` reads. Cases
  (1) and (2) found in Slice 6.7's final review (2026-11-23); developer
  ruled to ship canon-literal and route here. Case (3) found in
  Slice 6.7's slice review (2026-11-23).

- **A row label scrambles a name holding `{{entry}}`.**
  `history:rowLabelWithEntry` (`{{op}} {{name}}, {{entry}}`) is the
  label `DeltaLogRow` gives a pressable row with an entry
  (`components/compounds/delta-log-row.tsx:95-102`); History's rows take
  the name from `lib/history/humanize.ts`. i18next fills a placeholder
  at the first match of its text, including inside a value it already
  inserted, so a target named `Rope {{entry}} x` reads
  `update Rope entry_7 x, {{entry}}` (i18next 26.3.0, checked on
  2026-11-23). `history:rowLabel` (`{{op}} {{name}}`) and
  `history:link.target` (`{{label}} · {{name}}`, `humanize.ts:90-93`)
  put the user's text last, so they hold in English and would break
  only under a locale that reorders their placeholders. The change
  prose's `fill` helper (`lib/history/diff-prose.ts:54-65`) is the
  pattern that fixes it. Pre-existing. Found in Slice 6.7's slice review
  (2026-11-23).

- **The diff cache repeats rules the action layer owns.** Two copies
  sit across the `lib/actions` → `lib/history` boundary, which only
  `lib/history` may cross:
  - `firstSpellings` (`lib/history/diff-prose.ts:224`) restates the
    private first-occurrence rule of `spellings`
    (`lib/actions/delta/term-list.ts:15`), so a change to how a list's
    spelling is picked would leave the prose naming another spelling
    than the reversal restores.
  - `COLLISION_COLUMNS` (`lib/history/prose-fields.ts:119`) is the
    fourth copy of the collision trio, beside `FLAG_COLUMNS`
    (`lib/actions/entities/register.ts:120`), `COLLISION_FLAG_COLUMNS`
    (`lib/actions/delta/user-precedence.ts:218`) and `FLAG_FIELDS`
    (`lib/pipeline/definitions/close-agent/lifecycle-tools.ts:68`).

  Folding either needs a new export on the `lib/actions` barrel.
  Found by Slice 6.7's slice review (2026-11-23); the simplifier left
  them.

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
  (2026-11-24).

- **Older test seeds skip the row types.** Some suites build seed rows
  as untyped literals held together by `as const`, such as
  `setup()` in `lib/actions/relationships/register.test.ts:35-44`.
  Drizzle's `.values()` drops a key that isn't a column without an
  error, so a misspelled column there quietly keeps its default, and a
  fixture meant to differ doesn't. Typing the builder
  (`NewEntity` and the like) makes the typo a compile error. Slice
  6.10 typed its own `branch scope` builders; the older seeds are out
  of its scope. Found by Slice 6.10's slice review (2026-11-24).

- **The `branch scope` blocks repeat their helpers.** The chapters,
  entry-assets, era-flips and translations register suites each define
  near-identical `forked`, `<table>On`, `undoPayloadsOf` and `onFork`
  helpers and the same payload-case shape; lore, threads and
  happenings share a second pattern (`twoBranches`, `deltasOf`,
  `TARGET_MISMATCH`). A shared test module beside
  `lib/db/__tests__/two-branch.ts` could hold them, at the cost of
  table-generic typing the per-suite readers don't need. Slice 6.10's
  simplifier left them, since the move needs a new home. Found by
  Slice 6.10's slice review (2026-11-24).
