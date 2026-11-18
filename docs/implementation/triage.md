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

- **`architecture.md` describes an Anthropic catalog adapter that doesn't
  exist.** [`architecture.md → The window figure`](../architecture.md#the-window-figure)
  says "Anthropic's typed catalog adapter
  reads `max_input_tokens` the same way", but nothing under `lib/` reads
  `max_input_tokens`, and `lib/ai/catalog.ts` has no Anthropic adapter.
  Either the sentence goes or it gains "(not built yet)". Raised in
  5.10's PR 1 review.
- **Pre-flight's failure log drops what failed.**
  `pipeline.preflight_failed` (`lib/pipeline/runtime/orchestrator.ts`,
  `driveRun`) logs only `errorKind` and `errorDetail`. A
  `config-resolver` refusal carries no `detail`, so its `failure`,
  `target`, `phaseName` and `modelId` never reach diagnostics: a close
  refused for tool calling logs the same line as a missing profile.
  Raised in 5.10's PR 1 review.
- **A run off the open story pre-flights without the story's override.**
  `driveRun` passes `storySettings` only when the run's story and branch
  are the open ones (`ownStory`), so a run on another story checks the
  profile's model, not the override's. 5.10's tool-calling check inherits
  this. Whether such a run is reachable today is unchecked. Raised in
  5.10's PR 1 review.
- **A store patch can be lost while a story opens.** `loadAndPublish`
  (`lib/actions/stories/operational.ts`) reads the entries, makes about
  nine more awaited reads, then hydrates; an `entriesStore` patch that
  lands in between (any patching writer, `raiseSystemEntry` included) is
  overwritten by the older snapshot. Whether a write during an open is
  reachable is unchecked. Raised in 5.10's PR 1 review.
- **The threshold-met test has two copies.** `isReadyToClose`
  (`lib/chapters/is-ready-to-close.ts`) and `closeOwed`
  (`lib/pipeline/definitions/memory-chain.ts`) each write
  `tokens >= threshold && canClose`. `autoClose` keeps them apart today,
  but a change to one alone (say `>`) would make the auto close and the
  `Ready to close` label disagree at the same count. One shared predicate
  would hold it, as `canEndChapter` does for the end rule. Raised in
  5.10's PR 1 review.
- **Boundary's candidate lines split badly on some prose.**
  `firstLastSentences` (`lib/text/first-last-sentences.ts`) splits after
  a title's period ("Mr. Smith arrived." opens with "Mr."), starts the
  next sentence with a French closer that stands mid-text ("» Il
  partit."), gives "..." as the first sentence of a text that opens
  with one, and doesn't split on markdown emphasis or Japanese
  half-width marks. Each degrades a candidate's `Opens:` or `Ends:` line
  rather than breaking the call; worth a look once the probe or a real
  story shows boundary picking worse for it. Raised in 5.10's PR 1
  review.
