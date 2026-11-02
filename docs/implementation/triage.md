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

- **A turn's `config-resolver` entry offers Retry.**
  `useSystemEntryActions` (`components/reader/system-entry-actions.tsx`)
  returns `onRetry` unless the pass is `held` or `resolved`, where
  [`reader-composer.md`](../ui/screens/reader-composer/reader-composer.md#transient-pipeline-failures--system-entries-in-chat)
  lists `Fix profile · Dismiss` for a missing provider. Existing drift
  that no M5 slice owns. Raised 2026-11-01 by the M5 promotion.
- **React Query reads pause offline in the Electron renderer.**
  `createQueryClient` (`lib/cache/query-client.ts`) sets no
  `networkMode`, so once the window's `offline` event fires a read on a
  new key pauses, though these are local SQLite reads.
  `useEntryIndex` (`hooks/use-entry-index.ts:99`) and `useRowSignals`
  (`hooks/use-row-signals.ts:67`) have this on main, and
  `useChapterProgress` opts out for itself. One default in
  `createQueryClient` fixes all three, and that hook's own line can then
  go. Raised 2026-11-01 by Slice 5.1's planning.
- **The mock LLM's token count has no run guard.**
  `scripts/mock-llm/respond/wire.ts:48-52` keeps its own `countO200k`,
  though its comment says it mirrors `countTokens`. On a fixture with a
  run over 512 code points the two differ by a few tokens per cut, and
  the mock pays the quadratic cost. No `e2e/` or mock fixture repeats
  100 times or more, so nothing hits this today. Raised 2026-11-01 by
  Slice 5.1's review.
- **Two definitions of the open region omit `system`.**
  [`data-model.md → Chapters / memory system`](../data-model.md#chapters--memory-system)
  and `readPromptBuffer`'s docblock (`lib/retrieval/buffer.ts:49`) define
  it by `chapter_id IS NULL` alone, while `openRegionWhere` also leaves
  out `system` rows. Raised 2026-11-01 by Slice 5.1's review.
- **`useEntryIndex`'s docblock overclaims.** `hooks/use-entry-index.ts:67`
  says `settleCount` and the tail cover every `story_entries` write, but
  world-time edits and system entries move neither. It's harmless there,
  since `readEntryIndex` selects no metadata and excludes `system`.
  `useChapterProgress`' docblock has the narrower wording. Raised
  2026-11-01 by Slice 5.1's review.
- **Uncaught synchronous renderer errors reach no diagnostics entry.**
  `lib/boot/rejection-handler.ts:67` listens for `unhandledrejection`
  only, so on desktop a throw in a timer or an idle callback reaches the
  console alone. Raised 2026-11-01 by Slice 5.1's review.
- **A test comment cites a slice.**
  `lib/actions/story-entries/register.test.ts:308` names `Slice "Kind
coverage"`, a class `.claude/rules/code.md` bans. Raised 2026-11-01 by
  Slice 5.1's review.
- **Two docs lag the tokenizer.** `tech-stack.md`'s token-counting
  section says `cl100k_base` or `o200k_base` and that tables load on
  demand, where `lib/tokens` imports o200k's ranks statically. The token
  lesson says the build takes ~272 ms, and `lib/tokens/index.ts` ~285 ms.
  Raised 2026-11-01 by Slice 5.1's review.
