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

- **`cascadeDeleteOps` never fires when reverse-replay undoes a
  `create`.** The registry hook (`lib/actions/delta/registry.ts`) is read
  in exactly two places — the explicit `deleteHappening` handler and
  `redo.ts` re-applying a `delete` — while `reverse-replay`'s create arm is
  a bare row delete. So a registered cascade silently does not cover the
  undo path, and `happenings` is registered as though it does. Nothing had
  hit it because a suffix rollback takes every reference down with its
  target; the content-edit reversal is the first entry-scoped caller and
  closes the set by hand in `classifier-facts.ts`. Either the registry
  should consult the hook on create-undo, or the hook wants documenting as
  delete-op-only so the next caller does not assume coverage it lacks.
  Unowned: it is a delta-layer contract, not any one surface's work.

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

- **The Q4 query slot's cost is projected, not measured, and no slice
  owns measuring it.** The
  [query-stack design](../explorations/2026-09-06-retrieval-query-stack.md)
  takes the retrieval pass from three query vectors to as many as six,
  and states plainly that the numbers in
  [`retrieval.md → Per-turn cost budget`](../memory/retrieval.md#per-turn-cost-budget)
  were not re-run: the ~143ms / ~250ms figures are a linear
  extrapolation of a measured three-query table. Two terms sit outside
  even that extrapolation — the embedder, which every figure in that
  table explicitly excludes and which doubles from three calls per turn
  to six, and mobile, which has never run the ranker at all and now
  doubles an already-open risk. The doc assigns both to "whichever slice
  implements Q4"; no such slice exists, and M3.4 is closed. Route this
  to that slice's Open questions the moment it is drafted, so the
  planning gate forces `pnpm bench:retrieval` to be re-run against the
  real stack before the numbers in canon are trusted.
  **Owner: PR 2 of the query-stack stack**, the one that sources Q4
  from `metadata.retrievalQueries` — the mechanism landed without a
  slice, so nothing will fire the routing above. PR 2 is where Q4
  first costs anything, and it carries the re-run.

- **Nothing decides when a degenerate retrieval query should be
  dropped.**
  [`retrieval.md → Redundancy`](../memory/retrieval.md#redundancy--reporting-a-degenerate-query)
  captures, per emitted Q4 query, the share of its own top-K the
  structural floor had already seated — the measure that makes a useless
  query distinguishable from a useful one, which is precisely what the
  removed prose-extract slot could never report. It is deliberately
  observability-only in v1: acting on it needs a threshold, and setting
  one needs data that does not exist yet. The parked Tier-2 tuning
  surface covers _exposing_ ranker knobs, not the decision to drop a
  query, so this has no home there. Revisit once real captures
  accumulate; the answer may be that no automatic drop is wanted and the
  number stays diagnostic.
