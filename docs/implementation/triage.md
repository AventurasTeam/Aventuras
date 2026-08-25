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

- **An orphan that will not reverse is suspended, never resolved.**
  Raised 2026-08-24 disproving the crash-mid-burst followup; the
  classifier half is closed as of 2026-08-25.
  `resetStuckClassifierRunState` now consumes the recovery pass's
  failures and leaves a branch still holding their deltas `running`,
  which suspends the cadence, so the automatic path can no longer
  re-read a window whose partial writes are on disk. A second fix the
  same day made the `pipeline_runs` marker settle inside the reversal's
  own transaction: written separately, a failure between the two left the
  deltas reversed and the orphan open, and the replay is not idempotent —
  undoing a `create` deletes (repeatable) but undoing a `delete`
  re-inserts (conflicts), so one transient error hardened into a
  permanent one on every later boot. Failures now also reach the user
  through the existing crash-recovery modal, which no longer titles
  itself "Story recovered" when nothing was reversed. Two gaps survive,
  both cross-cutting:
  - **The gate is keyed on the classifier having been mid-run, not on
    the branch being hazardous.** A branch is only held back if its own
    `classifier_status` was left `running`. When some other kind's
    orphan fails to reverse and the classifier happened to be `idle`,
    nothing holds the branch: the cadence fires over a window carrying
    those un-reversed writes. `[Run classifier now]` bypasses the
    suspension by design, and the other kinds are event-triggered with
    no equivalent gate at all. One rule at run-start — refuse to start
    any kind on a branch with un-reversed orphan deltas — would cover
    every kind, the manual override, and this asymmetry together, but it
    needs the concurrency contract to learn about orphans.
  - **`abortRun` strands its deltas when its own reversal fails.** The
    marker now rides the reversal transaction on the success path, but
    when reverse-replay throws, `abortRun`
    (`lib/pipeline/runtime/orchestrator.ts`) still settles the marker
    with `outcome: 'failed'`. `recoverInFlightRuns` selects on
    `finished_at IS NULL`, so boot never sees that run and the
    un-reversed writes are stranded with no retry at all — worse than the
    boot path, which at least keeps trying. Leaving the marker open
    instead would hand it to boot recovery, but it also re-opens a run
    the user was told had finished; that trade has not been made.
  - **A permanently unreversible orphan has no resolution.** Boot retries
    the reversal each time, so anything transient self-heals; what
    remains is version skew — a delta naming a domain the running build's
    registry lacks (`unknown target_table`), which no retry can fix. The
    TODO at the catch site (`lib/pipeline/runtime/recovery.ts`) proposes
    deleting the orphaned rows: **not viable as written.** Deltas are the
    undo stack (`undoLastAction` reads them through `selectUndoTarget`),
    so deleting them erases undo history while leaving the writes they
    describe in place, and the next ctrl-Z reverses an older action
    against a state it never saw.
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
