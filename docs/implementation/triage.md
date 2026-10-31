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

- **A `partialChapterBuffer` of 0 reads as 1.** The Memory tab and
  `storySettingsSchema` accept 0, and the comment in
  `lib/retrieval/buffer.ts` says 0 "asks for no window at all", but
  `settingsCount(…, 1)` floors it to 1 and `buffer.test.ts` calls it
  unreachable. Canon doesn't say which is meant. Raised by the
  2026-10-31 triage pass.

- **A chapter close can't persist its failure's `close` field.**
  [`data-model.md → Entry metadata shape`](../data-model.md#entry-metadata-shape)
  gives `systemFailure` a `close?`, and `lib/db/story-entries/entry-metadata.ts`
  has none, so zod would strip it. No writer exists yet; M5's must add
  it. Read, not exercised. Raised by the 2026-10-31 triage pass.

- **A synchronous throw from the narrative's `streamText` escapes its
  error handling.** It's outside the `try` in
  `lib/pipeline/definitions/per-turn.ts`, so it lands in the
  orchestrator's catch as `orchestrator`, and `boundedSignal`'s timer
  isn't disposed. Bounding `maxOutput` removed the one known trigger.
  Read, not run. Raised by the 2026-10-31 triage pass.

- **A stale `Retry` after a failed reload can run the turn the composer
  still holds.** A `Dismiss` whose reload fails leaves the card up with
  its `Retry`, beside the text it handed back, and `Dismiss` takes no
  dispatch guard. The toast now says to reopen the story; nothing stops
  the tap. Read, not run. Raised by the 2026-10-31 triage pass.

- **Raw strings skip `t()`.** `components/ui/multi-select.tsx` and the
  `Edit raw — coming later` hint in `components/compounds/json-viewer.tsx`.
  Raised by the 2026-10-31 triage pass.

- **Latte's muted text misses AA on sunken surfaces.** `--fg-muted` is
  3.20 and `--fg-secondary` 4.05 on `--bg-sunken`; the audit checks both
  only on `--bg-base`. Raised by the 2026-10-31 triage pass.

- **Canon's capability hint covers tool calling, and the code doesn't.**
  [`generation-pipeline.md → Fatal error categories`](../generation-pipeline.md#fatal-error-categories)
  lists `tools` and `tool_choice`; `CAPABILITY_HINT_KEYWORDS` in
  `lib/ai/transport/classify-provider-error.ts` has neither. May simply
  be unbuilt until M5's close steps send tools. Raised by the 2026-10-31
  triage pass.

- **A profile's `timeout` is still a bare `z.number()`.** `maxOutput` and
  `thinking` got bounds in the 2026-10-31 triage pass; nobody checked
  what `boundedSignal` does with 0 or a negative. Raised by that pass.
