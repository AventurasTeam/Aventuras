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

- **`chaptersStore.patch` takes a raw row from any caller.** The
  working-set store's `patch` casts `p.row` and `p.columns` to the row
  type (`lib/stores/factory/working-set-store.ts:28,33`), so a direct
  caller would put `closeReport` into the store, skipping the
  projection at the chapters patcher. Today only the patcher and the
  hydrate write the store; the guarantee is convention. Surfaced by
  Slice 5.2's review.
- **The chapters update keeps unchanged columns in its undo payload.**
  Unlike lore (`lib/actions/lore/register.ts:125-130`), which drops
  them because History reads an undo payload's keys as the fields that
  changed (`lib/actions/chapters/register.ts`, the update handler).
  Matters once a chapter edit shows in History. Surfaced by Slice 5.2's
  review.
- **Partial `TxState` fixtures escape the type checker.**
  `lib/pipeline/definitions/suggestion-refresh.test.ts:207-212` builds
  one cast `as never`, already without `deferred` and `pendingClose`,
  so a new `TxState` field never flags it. Harmless while
  `isUserEditBlocked` reads only what it has.
- **A bundled template's group is declared twice, unchecked.**
  `lib/prompts/bundled/index.ts` sets each template's `group` (read by
  the include validator) and `TEMPLATE_GROUPS` declares it again;
  changing one alone leaves every prompt test green. Applies to every
  template.
- **The story-entry handlers' branch scope is untested on update and
  delete.** `lib/actions/story-entries/register.test.ts`'s `seed`
  creates only branch `b1`, so dropping the branch condition from
  those handlers' writes stays green (entry ids repeat across branches:
  the PK is `(branch_id, id)`). The stamp handler's case shows the
  shape.
- **Refusal codes repeated as literals.** `'branch-not-open'`
  (`lib/actions/classifier/run-now.ts:11`) and `'embedder-swap'`
  (`lib/actions/turns/submit-turn.ts:38`) restate
  `MANUAL_CLOSE_REFUSAL.branchNotOpen` and `.swapPending`
  (`lib/actions/chapters/start-manual-close.ts`).
- **Pre-flight reads the open story's settings after two awaits.**
  `lib/pipeline/runtime/orchestrator.ts:537-540` reads
  `currentStoryStore.getCurrentStory()?.settings` after `beginRun` and
  `settleUserWrites`; a story switch in between checks the wrong
  story's settings. Unverified as reachable.
- **`ResolveModelConfig` is built inline at each structured caller**
  (`lib/pipeline/runtime/preflight.ts:18`, and under
  `lib/pipeline/definitions/`: `periodic-classifier.ts`,
  `suggestion-refresh.ts`, `per-turn-piggyback.ts`,
  `chapter-close-metadata-call.ts`; `per-turn.ts` builds it inline
  too). One builder would keep a new field from being missed at one of
  them.
