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

- **Five dialogs write out the same inline status and alert lines.**
  The blocked or refused line (`role="status"`) and the failed line
  (`role="alert"`, `accessibilityLiveRegion="assertive"`, `text-danger`)
  repeat in `branch-delete-confirm.tsx`, `duplicate-story-dialog.tsx`,
  `branch-create-modal.tsx`, `scene-edit-form.tsx` and
  `world-time-edit-form.tsx`. A shared compound in
  `components/compounds/` would keep their roles and live regions in
  step; it touches files outside any one slice. Found by Slice 6.6's
  slice review (2026-11-26).
