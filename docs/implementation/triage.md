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

- **C11 names four handlers with a hard `not-found`; more have one.**
  [C11](./milestones/05-chapters-chapter-close/milestone.md#c11--tool-results)
  lists `updateEntity`, `updateLore`, `updateThread` and
  `updateHappening` as returning a hard `not-found` that aborts a group.
  `updateEntityVisualState`, `updateEntityInventory`,
  `updateEntityStackables`, `updateItemPosition` and
  `updateEntityLocationTracking`
  (`lib/actions/entities/state-patch-actions.ts`) and `updateInvolvement`
  (`lib/actions/happenings/register-involvements.ts`) do too, so a close
  tool over one of them gets a whole-group refusal where C11's table
  reads as a per-action verdict. Raised in 5.5a's review.
- **Handlers read committed rows, so a row created earlier in the same
  group reads as missing.** `placeLocationHandler` takes no `GroupScope`
  (`lib/actions/entities/state-patch-actions.ts`), and the
  `partner-not-found` and each target's `... not found` refusals read the
  same way. 5.5a marks all of them `gone`, so once the close's
  verdict mapping reads marks the model would hear that a row it just
  created is gone. The fix is reading the group's created rows through
  `GroupScope`, not a mark special case. Nothing groups a create with
  such a write yet; a close tool that does needs it. Raised in 5.5a's
  review.
- **A row the group creates passes as a faction.** `membershipKind`
  (`lib/actions/entities/state-patch-actions.ts`) reads any row in
  `GroupScope.created` as a faction, since the scope holds keys only, so
  a `setCharacterFaction` naming a character or place the same group
  creates would land. `GroupScope.created` should carry each created
  row's kind, so that write is refused `not-a-faction`. No writer
  reaches it today: the classifier resolves its faction ref by kind and
  writes through `delta_emitted`, outside a group. A close tool that
  groups a create with a membership would. Raised in 5.5a's review.
- **A parallel group's failing branch outlives the reversal.**
  `runParallelGroup` (`lib/pipeline/runtime/orchestrator.ts`) awaits
  `Promise.all`, so one branch's throw reverses and fails the run while
  its sibling keeps going; the sibling's next write lands under the
  run's `actionId` after the reversal and is never reversed. Canon says
  to drain the streams and wait for every branch
  ([Parallel-group event coordination](../generation-pipeline.md#parallel-group-event-coordination)).
  Shown by probe on both write paths in 5.5a's review; latent, since no
  production pipeline declares a parallel group.
- **`consumePhase` never closes a phase whose event throws.** When
  `handleEvent` throws, the generator gets no `return()`, so a phase's
  `finally` around a `yield` never runs. No phase has one today
  (`chapter-close-metadata-call.ts`, `periodic-classifier.ts` and
  `per-turn-retrieval.ts` checked). Raised in 5.5a's review.
- **The two write paths disagree on what a bus event means.** A
  `delta_emitted` noop or refusal never reaches the bus, while a
  `delta_group_emitted` reaches it whether the group landed, no-oped or
  was refused whole (`handleEvent`, `lib/pipeline/runtime/orchestrator.ts`).
  [Phase iteration](../generation-pipeline.md#phase-iteration) says the
  orchestrator forwards every event. No production code subscribes to
  delta events yet; one rule for both paths is wanted before one does.
  Raised in 5.5a's review.
- **`promoteStagedEntity`'s store-only guard can still refuse a
  legitimate promotion while a story opens.** `loadOpenStory` reads
  `entities`, then hydrates after eight more reads, so a write or
  reversal landing in between leaves the store copy active over a
  DB-staged row, and `promoteStagedEntityHandler` refuses `not-staged`;
  since 5.5a that reads `rejected`, not `ok`. The row lock may make the guard
  redundant: `promoteStagedEntity` takes the row's lock key, so two
  promotes through the action layer serialise and the second reads the
  DB already active. The lock did not come later: `ae48d4513` (M3.2)
  added both, `a6d81c572` (M4.2a) only widened the key. The stale store
  itself is the next entry. Raised in 5.5a's review.
- **A write that commits while a story opens is lost from its stores.**
  `loadOpenStory` (`lib/actions/stories/operational.ts`) reads every
  working-set table one after another, then hydrates them all together,
  so a write committing in between is lost from the store, either way:
  if the store already holds that branch, the write's patch applies and
  the hydrate overwrites it; if not, the patch is dropped
  (`lib/stores/factory/working-set-store.ts`, a branch the store doesn't
  hold) and the hydrate brings the older rows. World and the other store
  readers show the old row until the next open. The writers that can
  land in that window are background runs on that branch: a pass, or a
  close. Raised in 5.5a's review.
- **`teardown.spec.ts`'s rejected-close case can hang its first attempt,
  and the hang fails the shard though the retry passes.** "a rejected
  close still ends the app before its userData goes" timed out at its
  120 s on the packaged project in CI, then the worker's teardown passed
  Playwright's 90 s, an error outside any test; the retry passed in 4 s.
  Seen once (PR 717, E2E shard 3/3, run `42462233487`, 2026-11-08) on a
  docs-only push whose code had passed E2E one push before. Not yet
  traced: whether the hang is in the harness ending the app after the
  rejected close, or in the app itself. Raised in 5.5a's review.
