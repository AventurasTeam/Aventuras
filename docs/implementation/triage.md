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

- **Test plumbing the M6.1 simplifier left duplicated.** Three test
  modules hand-roll `BEGIN` / `COMMIT` / `ROLLBACK` on a raw
  `DatabaseSync`: `lib/db/branch-copy/vec-copy.test.ts:92`
  (`runInTransaction`, "As createTestDb's"),
  `lib/db/__tests__/migration-runners.ts:33`
  (`migrateLikeAndroid`, which models expo's runner and may need to stay
  apart) and `lib/db/__tests__/two-branch.ts:91` (`cloneBranch`). A
  shared helper would live beside `createTestDb`'s own in
  `lib/db/__tests__/test-db.ts`, which `migration-runners.ts` already
  imports. Slice 6.8 moved the migration runners out of
  `migrate-m6-deltas-key.test.ts` into that module, shared with its lead
  migration test; the three transactions stand. Separately,
  `lib/actions/story-entries/scene-fields.test.ts:248`
  and `:315` spell out the call its `removeCast` helper makes (`:216`).
  No defect either way. Found by M6.1's slice review (2026-11-22); the
  runner's pointer moved by Slice 6.8's slice review (2026-11-25).

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

- **A successful story load's open-failure clear is untested.**
  `loadAndPublish` in `lib/actions/stories/operational.ts` calls
  `storiesStore.clearOpenFailure(storyId)` before it publishes;
  deleting the line leaves the three load suites green (28 tests). The
  line predates Slice 6.4, which only moved it. Found in Slice 6.4's
  reviews (2026-11-24).

- **Diagnostics settings show capture off in a dev build that forces it
  on.** The debug switch in
  `components/compounds/diagnostics-settings-panel.tsx:32` is disabled
  on the stored flag, while a dev build forces capture on
  (`lib/boot/bootstrap.ts:39-42`). So the panel reads capture off and
  debug disabled while capture runs, and turning debug on needs capture
  toggled first. Hit on desktop and the slot AVD in Slice 6.4's device
  passes (2026-11-24).

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
  separator. Both predate Slice 6.4's edit. Found in Slice 6.4's
  reviews (2026-11-24).

- **A second `beforeRemove` preventer replays its action and the arm
  registry doesn't see it.** `hooks/use-story-leave-guard.ts:60-64`
  keeps `data.action` and replays it on "Cancel & leave", and
  `isUnsavedPopArmed` doesn't cover it. A switch's stack reset could be
  swallowed by it only if a run started on the story between the
  switch's gate check and its reset: unreachable today, since every
  pipeline is `hard-gate` and `switchBranch` also refuses on
  `isStoryBusy`. `switchBranch` checks `isStoryBusy` again right before
  its reset, with nothing awaited between. A switch could still meet
  the guard only while its arming render lags a run that just ended,
  which needs the run's end and the switch's last step in one
  microtask checkpoint; none was found (each desktop IPC reply is its
  own task, and a zustand write renders before the next task; read
  from the code, not run on a device). The tail (`showBranch`) takes
  no such check, so it is the path left to meet it. Pre-existing.
  Found by Slice 6.4's reviews (2026-11-24).

- **A late `onDismissed` from an earlier close can release a row held
  by a reopened presentation.** After a reopen during a dismiss, the
  earlier close's `onDismissed` runs the held row (e.g. the phone
  `Browse branches…`) when that earlier exit ends rather than its own
  (`components/ui/searchable-overlay-list.tsx` around :1361;
  `OverflowMenu` has the same shape). Benign per Slice 6.4's recorded
  gorhom fact: a Sheet presented during another's dismiss presents, and
  the dismissing one doesn't come back, on web and the AVD. Scoping
  `onDismissed` to the presentation that started the close is a
  Sheet-primitive change. Found in Slice 6.4's PR review (2026-11-24).

- **`Input` has no 44 px phone floor at `size="sm"`.**
  [`touch.md → Touch-target floor on phone`](../ui/foundations/mobile/touch.md#touch-target-floor-on-phone)
  floors phone form inputs at 44 px, through `--control-h-md` and a
  defensive floor at the input wrapper; `components/ui/input.tsx` maps
  `sm` to `h-control-sm`, under 44 px at the compact and regular
  densities, with no floor. The branch rename input was its only
  production `size="sm"` use and now sets its own 44 px floor on phone.
  Pre-existing substrate. Found in Slice 6.4's reviews (2026-11-24).

- **The reader's state chips repeat one class string.** The branch
  chip (`components/reader/branch-chip.tsx`), the chapter chip
  (`components/reader/chapter-chip.tsx`) and the rail's browse chip
  (`components/reader/rail/browse-chip.tsx`) each spell the same chip classes
  and web focus ring; a change to the chip's look has to land in all
  three. A shared chip primitive or class helper is the fix; it needs
  a home outside any one reader surface. Found in Slice 6.4's reviews
  (2026-11-24).

- **Storybook tier helpers are copied per story file.** `waitForTier`
  and `TierMark` are written out in five story files (the branch chip,
  navigator and rename input stories, the chapter popover's, and the
  chapter-in-progress card's), two of them older than Slice 6.4. A
  shared story helper beside the viewport lesson's pattern would hold
  them once. Found in Slice 6.4's reviews (2026-11-24).

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

- **An unguarded `json_extract` on entry metadata.**
  `lib/db/story-entries/chapter-time-ranges.ts:10` runs `json_extract`
  over `story_entries.metadata` with no `json_valid` guard. A branch
  holding malformed metadata, which the M6 lead backfill leaves as it
  was, makes that read throw `malformed JSON`. Slice 6.8 guarded its
  own stamp read (`lib/db/story-entries/lead-stamps.ts`); this one is
  older. Found in Slice 6.8's reviews (2026-11-24). A second site,
  `lib/entry-refs/read.ts:140`, reads `metadata.worldTime` through the
  same unguarded `json_extract` for `readOpenRegionTimes`, which the
  close modal runs each time it opens. Found by Slice 6.8's slice review
  (2026-11-25).

- **State-patch writes take any entity column.**
  `columnsWriteOutcome` in `lib/actions/entities/state-patch-actions.ts`
  writes any `Partial<Entity>` with no allowlist. Every caller names
  its columns today, but nothing stops a later state-patch handler from
  writing `isLead`, which the register's source rule guards only in
  `updateEntity`. Found in Slice 6.8's reviews (2026-11-24).

- **The collision dialog's `GATED` comment may be over-broad.**
  `components/compounds/collision-resolve-dialog.tsx` says rn-primitives
  doesn't gate disabled clicks on web, and its plain radio items carry
  an inline `pointerEvents: 'none'` for it. Slice 6.8's review showed
  the dialog's `Select` items drop a disabled press already (an RN-Web
  `Pressable` under the rn-primitives item), and read the same item
  under the plain radios. Unverified for those by mutation; if it
  holds, the inline style and the lesson behind it are narrower than
  stated. Found in Slice 6.8's reviews (2026-11-25).

- **A create's payload admits the lead flag.** `createEntity`'s
  payload is `{ entry: NewEntity }`
  (`lib/actions/entities/register.ts:93`), and since `entities.is_lead`
  exists, `NewEntity` admits `isLead: 1`, which the handler refuses
  only at runtime (`:227`, "a create never sets isLead"). The designed
  shape is `NewEntity & { isLead?: 0 }`
  ([`code-conventions.md → Type design`](../code-conventions.md#type-design),
  Known shape). Tightened in a scratch typecheck, it breaks 39 files:
  two in production, `lib/world/entity-actions.ts` and
  `lib/pipeline/definitions/per-turn-creates.ts`, and 37 test files and
  fixtures that build create entries as `NewEntity`. An exported alias
  such as `EntityCreate` for the fixtures is the likely route. The
  payload line is older code. Found by Slice 6.8's slice review
  (2026-11-25).

- **`RejectedStart.blockedBy` is a bare string.**
  `lib/pipeline/types.ts:237` types it `string`, while its values are a
  closed set: the pipeline and gate kinds a concurrency policy names
  (`ConcurrencyPolicy.blockedBy`, `:168`, is `string[]` too),
  `rerun-held`, `classifier-held`, `branch-not-open`, `embedder-swap`,
  the manual close's refusals and `lead-missing`. Callers branch on it
  by comparison (`leadRefusalOf` in `components/reader/send-run.ts`),
  so a misspelled code compiles. A union is the designed shape
  ([`code-conventions.md → Type design`](../code-conventions.md#type-design),
  Known shape). Older code; Slice 6.8 added `lead-missing`. Found by
  Slice 6.8's slice review (2026-11-25).

- **The observability inventory lacks the branch switch's kinds.**
  `docs/observability.md → Subsystem emission inventory` names no
  `action_layer.branch_switch_*` (`_navigation_blocked`,
  `_restore_retried`, `_restore_failed`, `_restore_reread_failed`,
  `_failed`) or `action_layer.branch_show_*` kind
  (`lib/actions/stories/switch-branch.ts`), nor
  `app.branches_refresh_failed` (`lib/stores/branches/branches.ts`).
  Slice 6.5's blocked-navigation restore now emits the restore kinds
  from the fork paths too. The inventory calls itself illustrative, so
  this is drift, not a contract break. Found by Slice 6.5's final
  review (2026-11-25).

- **The switch's input names the left branch twice.**
  `SwitchBranchInput` (`lib/actions/stories/switch-branch.ts`) takes
  `fromBranchId` beside `hold`, whose `branchId` is the same branch: the
  reader takes the hold on the branch it shows and passes that id again
  (`app/reader-composer/[branchId].tsx`, the switch's call). A failed
  switch writes `fromBranchId` back into `stories.current_branch_id`,
  which has no foreign key, so the two disagreeing would put the
  pointer on a branch the frozen reader doesn't show. Per
  `code-conventions.md → Type design` ("one argument where two could
  disagree"), restore to `hold.branchId` and drop the field. Slice
  6.5's review made the same change to `ShowBranchInput`. Found by
  Slice 6.5's slice review (2026-11-25).

- **Helpers copied across the reader's inputs and the E2E specs.** The
  IME guard (`isComposing`, `IME_KEY_CODE`) is now in both
  `components/reader/branch-rename-input.tsx` and
  `branch-create-modal.tsx`; one `components/reader/` module could
  serve both. In the specs, `branchName` and `entryContent` in
  `e2e/tests/branch-navigator.spec.ts` repeat `branch-fork.spec.ts`'s,
  and `chapter-delete.spec.ts` keeps its own `expandCard` beside
  `e2e/flows/close-rerun.ts`'s `expandChapterCard`. Slice 6.5's
  simplifier left them, since each move edits a file outside the
  slice. Found by Slice 6.5's slice review (2026-11-25).

- **The evaluation set's appended checks are unpinned.**
  `EVAL_WINDOWS` (`scripts/classifier-eval/index.ts`) appends
  `refsResolve(w)` to every window, and no test asserts it: removing it
  leaves `scripts/classifier-eval` green, and the probe silently stops
  checking that a reply's refs resolve. A `windows.test.ts` case that
  every window's check names include the appended checks would pin it.
  Found by Slice 6.9's Task 3 review (2026-11-25), which adds a second
  appended check, `toldInThirdPerson()`, with the same gap.

- **The dataset build leaves the story in the third person.** The
  wizard drive in `e2e/tests/dataset-chapter.build.spec.ts`
  (`createAdventureStory`) keeps the wizard's default narration,
  `third`, while the dataset's prose is Jim's first person. Slice 6.9
  set `"narration": "first"` in
  `scripts/dataset-chapter/treasure-island.seed.json`, so the close
  probe tests a first-person story whose summary must still be told in
  the third person; a fresh build, once exported
  (`dataset:export-seed`), reverts it. The drive should pick first
  person in the wizard. Found by Slice 6.9's planning (2026-11-25).

- **The mutator fences match the literal identifier `generationStore`,
  so an aliased import bypasses all of them.** The
  `no-restricted-properties` entries built at `eslint.config.js:19-22`
  set `object: 'generationStore'`, which ESLint compares to the written
  name. Probe: `import { generationStore as g }` then
  `g.dropBranchRecords(...)` in `components/reader/` lints with 0 errors,
  against 1 for the plain name. Any owner-only mutator (run, close
  record, re-run record, drop, close progress) can be called through an
  alias from a file that may not. A `no-restricted-syntax` selector on
  the import specifier (ban the `as` rename of `generationStore`), or a
  rule that resolves the binding, would close it.
  Found during Slice 6.6.

- **The unfinished-run reads scan `pipeline_runs` whole.** The table
  has no index on `branch_id` (`lib/db/system/system.table.ts`), and
  nothing prunes finished rows short of a story delete, so it grows with
  every turn. `readUnfinishedRuns` (`lib/actions/delta/unfinished-runs.ts`)
  scans it per branch, the duplicate's check runs it twice per copied
  branch, and the duplicate's in-batch guard scans it once more. On a
  synthetic table the scan took 0.24 ms at 10k rows and 3.8 ms at 100k,
  so it passes 1 ms around 25–30k rows. A partial index on
  `pipeline_runs(branch_id) WHERE finished_at IS NULL` would make each
  read an index probe; it's a schema change, so it waits for an owner.
  Found during Slice 6.6.

- **Eighteen test files each define the same `deferred<T>()`
  helper.** A promise with its `resolve` and `reject` exposed, written
  out per file (`grep -rln 'function deferred<' components lib hooks`):
  the two new hook tests of Slice 6.6 (`use-branch-delete-confirm`,
  `use-story-duplicate`) and sixteen older ones. One shared test util
  would serve them all; it needs a home the unit project's files can
  import, and moving it edits files across the tree. Found by Slice
  6.6's slice review (2026-11-26).

- **Five dialogs write out the same inline status and alert lines.**
  The blocked or refused line (`role="status"`) and the failed line
  (`role="alert"`, `accessibilityLiveRegion="assertive"`, `text-danger`)
  repeat in `branch-delete-confirm.tsx`, `duplicate-story-dialog.tsx`,
  `branch-create-modal.tsx`, `scene-edit-form.tsx` and
  `world-time-edit-form.tsx`. A shared compound in
  `components/compounds/` would keep their roles and live regions in
  step; it touches files outside any one slice. Found by Slice 6.6's
  slice review (2026-11-26).
