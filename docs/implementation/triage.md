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

- **A failed Dismiss tells the user nothing.** The reader passes
  `handleDismissSystemEntry` unwrapped, and the card fires it as
  `() => void onDismissSystemEntry()` (`components/reader/reader-surface.tsx`),
  so a throw becomes an unhandled rejection. A failed delete leaves the
  tap doing nothing. A failed reload, which the hand-back now survives,
  leaves "text restored" beside a stale card. A pass entry's Retry goes
  through `runAction` and toasts its failure; Dismiss doesn't. The
  `void` predates the 2026-10-24 triage pass; raised by its slice
  review.

- **A boot whose recovery pass throws reports nothing.** When
  `recoverInFlightRuns` itself throws, `bootstrap.ts` logs
  `bootstrap.recovery_failed` and publishes the report with empty
  `reversed` and `failures`, so the modal shows only a held branch the
  read found, or doesn't open at all. The orphans it never reached stay
  on disk and the next boot retries them. Canon's crash-recovery copy
  ([`generation-pipeline.md → Crash recovery`](../generation-pipeline.md#crash-recovery-via-pipeline_runs-marker-table)) covers failed
  orphans, not a failed pass. Before the 2026-10-24 triage pass the
  report wasn't published at all on a throw; raised by its slice
  review.

- **The state report shows a change as emitted, not as stored.**
  `buildPiggybackActions` bounds a visual change's and a condition's text
  before writing it (`boundStateText` in `lib/piggyback/apply.ts`), but
  the report keeps the emitted text, so the entry card's panel can show
  more than World holds. Canon doesn't say which the panel shows.
  Raised by the 2026-10-24 triage pass's verification; filed by its
  slice review.

- **Small shared helpers the simplifier left for a home.** The 2026-10-24
  triage pass's slice review ran the simplifier and skipped four
  duplications that predate the range or need a new module:
  - The expression that reads an unknown throw's message (an
    `instanceof Error` check falling back to `String`) appears 60+ times across `lib`, `app` and `components`,
    beside eight local `messageOf` / `errorMessage` helpers; five of
    the copies sit in `lib/pipeline/runtime/orchestrator.ts` next to its
    own `messageOf`.
  - The orchestrator builds `run_complete` by hand at three sites
    (`unwindRun`, `commitRun`, `abortRun`).
  - The per-attempt `recoverable_error` loop is written three times
    (`per-turn-piggyback.ts`, `suggestion-refresh.ts`,
    `periodic-classifier.ts`); `call-error.ts` is the natural home.
  - `lib/classifier/schema.ts`'s happening entry writes
    `sourceTurn: z.string().optional()` inline while every other entry
    uses the shared `sourceTurn` const; sharing the instance wants the
    prompt-schema snapshots to confirm it.

- **`possibleCapabilityMismatch` is canon without code.**
  [`generation-pipeline.md → Fatal error categories`](../generation-pipeline.md#fatal-error-categories)
  and
  [`app-settings.md → Override semantic`](../ui/screens/app-settings/app-settings.md#override-semantic--trust-the-user)
  describe a provider-error mapper that matches capability words
  (`tool_use`, `thinking`, `vision`) in a rejection's body and threads
  the hit through `PipelineError.provider`; nothing in `lib/`
  implements it, and no ledger tracks the gap. The context window
  check's overflow recognition will be the first such matching in
  `classifyProviderError`, the natural home for this one too. Raised
  2026-10-26 by the context window design.
