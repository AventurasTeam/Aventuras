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

- **A boot recovery that fails to reverse leaves the branch runnable
  against un-reversed writes.** `recoverInFlightRuns`
  (`lib/pipeline/runtime/recovery.ts`) logs a per-orphan
  `DeltaReplayError` and leaves the row for the next boot — correct on
  its own, but `resetStuckClassifierRunState` runs immediately after
  and flips `classifier_status` to idle regardless, so the classifier
  can start a fresh pass over a window whose partial writes are still
  on disk. That is the duplication the (now removed) crash-mid-burst
  followup described, reachable only when recovery itself fails rather
  than on any ordinary crash. Cross-cutting: the same gap lets any kind
  re-run against its own un-reversed orphan. The code already carries a
  TODO at the catch site. Raised 2026-08-24 disproving that followup.
- **`app-actions-menu-pure.stories.tsx` depends on cross-file DOM
  cleanliness.** Under `--fileParallelism=false` the `Diagnostics On`
  story fails reproducibly (2/2) with the body still carrying a
  `data-density` attribute an earlier file set; it passes alone and
  under the default parallel run, where each file gets its own page.
  Latent rather than active — nothing runs the suite serially — but it
  means "run the browser project sequentially" is not available as a
  debugging move until the story stops relying on ambient body state.
  Cross-cutting: any story that reads app-level DOM state has the same
  exposure, so the fix is a cleanup contract, not one story's patch.
  Raised 2026-08-24 verifying the `pnpm test:run` gate followup.
