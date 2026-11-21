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

- **Reads of a delta group by `action_id` scan the log.** `deltas` has
  no index on `action_id`, so every group read by action walks the
  branch's log, or the whole table where the read has no branch filter:
  `reverseReplayDeltas`'s group read (no branch filter, every abort and
  recovery), `refuseWriteBack`'s group read, and the planner's
  journal-group read when a reversal takes from a re-run's group. Raised
  by Slice 5.13's reviews (2026-11-21), which narrowed the planner's read
  to the groups a set takes from; an index, or a branch filter on the
  abort read, is the fix. Worth measuring on a long branch before
  choosing.
- **A reversal's error names the newest delta's action, not the
  reversed one.** `reverseAndPruneDeltaRows` labels its
  `DeltaReplayError` with `set.rows[0]?.actionId ?? 'rollback'`, so a
  failed CTRL-Z of a group whose set holds a later user edit names that
  edit, and a set with no rows names `'rollback'`. Diagnostics only:
  callers read `detail` and `committed`. Raised by Slice 5.13's reviews
  (2026-11-21).
- **A committed undo whose store sync fails says to try again.** The
  reader's undo handler shows `Couldn't undo. Please try again.`
  (`locales/en/reader.json`, `useReaderUndo`'s guard) for any thrown
  undo, including a `DeltaReplayError` at `store-sync`, where the
  database change landed (a re-run's undone close excepted: it shows its
  close-undone warning). Trying again undoes the next group back; after
  a re-run's CTRL-Z that is the close it just restored. Pre-existing for
  every undo; raised by Slice 5.13's reviews (2026-11-21).
- **A committed reversal at boot whose store sync fails reads as
  retryable.** `recoverInFlightRuns` records the throw as a recovery
  failure, and the modal's `incomplete*` copy says the update "could not
  be undone" and that "restarting the app retries automatically". The
  reversal's transaction already settled the marker as `recovered`, so no
  later boot retries or reports it, and the stores resync from the
  database on the next load. Pre-existing for every orphan kind; raised by
  Slice 5.13's PR review (2026-11-21), which only added the close-undone
  line to this failure.
- **A throwing `onReserved` leaves its run registered.** The
  orchestrator calls `reserveRun`, and the caller's `onReserved` inside
  it, outside `driveOrigin`'s try and unwind
  (`lib/pipeline/runtime/orchestrator.ts`), so a callback that throws
  after the run registers leaves a hard-gate run no path removes until a
  restart. No caller throws today; `startCloseRerun` is the first to pass
  a host-supplied callback through it. Raised by Slice 5.13's Task 17
  review (2026-11-21).
- **The shared `Sheet` drops a `present()` sent while it is still
  dismissing.** An `open` that flips back to true within the slide-out
  (about 0.7 s on web) leaves the sheet open in React and nothing on
  screen: no scrim, its Escape and Back handlers still swallow presses,
  and the next close calls `dismiss()` on a dismissed modal
  (`components/ui/sheet.tsx`, the `open` effect). Slice 5.13 holds its own
  review-window reopen until `onDismissed`
  (`use-review-window-presence.ts`); other consumers that reopen a Sheet
  on a timer or after a cancelled confirm are unchecked. Raised by Slice
  5.13's Task 26 review (2026-11-21).
