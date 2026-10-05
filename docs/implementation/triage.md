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

  **Revisit trigger.** A browser-project regression that a parallel run
  cannot localise. That is the moment the missing debugging move costs
  something, and the moment a fourth serial run is worth what it takes
  to get. Held rather than routed in the 2026-09-09 triage pass, which
  did not re-run the suite serially — the evidence above is still as of
  `edce17b8`.

- **Canon disagrees on whether the periodic classifier introduces
  locations.** The `currentLocationId` row of
  [`piggyback.md → What piggyback writes`](../memory/piggyback.md#what-piggyback-writes)
  says a location new to the prose stays stale "until the periodic
  classifier creates it" and calls the cost a few turns of degraded
  retrieval, but the classifier's write set in
  [`classifier.md`](../memory/classifier.md#background-task-framing)
  and `lib/classifier/plan.ts` introduce characters only. Nothing
  machine-creates a location, so the stale id, and the wrong
  `state.current_location_id` the piggyback bookkeeping copies onto
  in-scene characters, last until the user creates the entity. Decide
  whether the classifier should introduce locations, or correct
  piggyback.md. Introducing them would revive the parked
  [closure gap for ids inside JSON](../parked.md#the-reversal-closure-doesnt-follow-ids-inside-json-columns).
  Raised by the 2026-10-05 triage pass.

- **Rollback and edit rejection copy always says "Please try again."**
  `reader:rollbackFailed` and `reader:editFailed`
  (`locales/en/reader.json`) cover every rejection code, including the
  persistent ones (`delta-failed` from an integrity refusal,
  `not-found`, `rollback-floor`), which a retry cannot clear. Regenerate
  avoids the loop only for its dispatch result, through
  `REGENERATE_REJECTION_COPY` in `app/reader-composer/[branchId].tsx`;
  its preview rejection in `handleRequestRegenerate` still toasts
  `reader:regenerateFailed` ("…Please try again."). Raised in the
  reversal-integrity PR's review (2026-10-05).

- **A kept (re-owned) create in `redoRows` fails redo with a raw
  SQLite error.** It is unreachable today only because no non-periodic
  machine source creates relationships and CTRL-Z skips periodic
  groups. If one is reached, the plain INSERT `applyRedoLocked`
  (`lib/actions/delta/redo.ts`) runs from the row `snapshotForRedo`
  captured hits a primary-key error rather than a refusal, since the
  kept row never left, and the redo stays pending. Add a guard
  or refusal before any non-periodic machine source creates
  relationships. Raised in the reversal-integrity PR's review
  (2026-10-05).

- **`buildUndoOps` is one ~265-line loop carrying every reversal rule.**
  `lib/actions/delta/reverse-replay.ts` holds the live and held arms,
  re-own, tombstones, stranded writes and two refusals in a single
  loop, with four hand-synced per-row presence structures. Extract the
  create and update arms (and their held variants) into named helpers,
  and consider one per-row state, before the next rule lands. Raised in
  the reversal-integrity PR's review (2026-10-05).
