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

- **A profile's max output accepts any number.** `maxOutput` in
  `lib/db/app-settings/app-settings-schema.ts` is
  `z.number().optional()`, so `0`, negative and fractional limits pass
  validation and are sent as `maxOutputTokens`. Since the cut-off
  replies work, the cause rule reads any output at or over the limit
  as `max-output` ([`generation-pipeline.md → Cut-off replies`](../generation-pipeline.md#cut-off-replies)),
  so a limit of `0` makes every cut-off read `max-output` and its copy
  quote a 0-token max output. Raised by the cut-off replies Task 1
  review.

- **Failure details the pipeline logs have no test.** The `errorDetail`
  of `pipeline.run_aborted` and `pipeline.phase_failed`
  (`lib/pipeline/runtime/orchestrator.ts`) is asserted nowhere, and the
  periodic classifier's `onPreflightFailure` hook
  (`lib/pipeline/definitions/periodic-classifier.ts`) is tested only for
  a resolver failure, not for its other branch, which records
  `pipelineErrorDetail(error)`. Setting either detail to `undefined`
  passes the suite. Raised by the cut-off replies Task 2 review.

- **The `provider.*` log kinds in `observability.md` are stale.**
  [`observability.md`](../observability.md) lists `retry_succeeded`,
  `rate_limited`, `stream_interrupted`, `request_failed` and
  `url_redaction_failed`. The code also logs `http_call_buffer_full`,
  `narrative_stream_failed`, `wizard_assist_failed`,
  `wizard_assist_threw`, `wizard_opening_unresolved_refs` and four
  `setup_*` kinds, and logs no `rate_limited`, `stream_interrupted` or
  `request_failed` by those names. The cut-off replies PR adds its own
  `reply_cut_off`. Raised by the cut-off replies Task 4 review.

- **Two trailing-block shapes leak markup into the prose.**
  `findBlockSpan` (`lib/piggyback/parse.ts`) pairs the last close tag
  with the opener before it, so in `<state>a</state>` followed by an
  unclosed `<state>` it never sees the second block, which stays in the
  prose and sets `outOfPosition`; on a cut-off reply the entry is also
  marked. When one block nests inside the other, `stripTrailingBlocks`'
  cursor moves backwards and the outer block's tail (its close tag
  included) is left in the prose. Both are rare model outputs. Raised by
  the cut-off replies Task 5 review.

- **System entries show their detail inline, with no `View details`.**
  The reader-composer failure table gives most rows a `View details`
  action
  ([`reader-composer.md → Transient pipeline failures`](../ui/screens/reader-composer/reader-composer.md#transient-pipeline-failures--system-entries-in-chat)),
  but `EntryCard` renders a system entry's `detail` as muted text under
  its content (`components/compounds/entry-card.tsx`), and no code
  offers the action. Raised by the cut-off replies Task 8 review.

- **Warning text fails contrast in Catppuccin Latte.** Latte's
  `--warning` (`#df8e1d`) on `--bg-raised` (`#e6e9ef`) is 2.15:1, so every
  `text-warning` line on a card (the state-problems box, the cut-off
  notice) misses AA. Every other theme passes. The
  [contrast audit](../ui/foundations/color.md) has no warning
  text-on-surface pair, and its Latte exemption covers only the pill
  fills. Raised by the cut-off replies Task 9 review.

- **On native, the reader rows' memo misses on every host render.**
  expo-dom hands every function prop a new identity per prop emission
  and emits on every host render (`node_modules/expo/src/dom/`:
  `dom-entry.tsx`, `marshal.tsx`, `webview-wrapper.tsx`), so the
  stable-callback reasoning in `components/reader/reader-surface.tsx`
  holds on web only. Read from the expo source, not measured on a
  device. Raised by the cut-off replies Task 10 review.

- **Wizard-assist shows raw diagnostics to the user.** For any failure
  other than a cut-off, `ai-assist.tsx` puts `describeCallRetryError`'s
  line into "Couldn't generate. {{reason}}.": a provider error's
  `label ← cause` chain or a JSON or Zod parse message, untranslated,
  possibly ending in a doubled period. Raised by the cut-off replies
  Task 11 review.

- **The dev mock's failure injection misreports in three spots.** In
  `scripts/mock-llm/completions.ts`, a lane with an upstream selected
  spends a `malformed`, `stream-cut` or `length` failure and logs the
  call as failed, then relays the upstream reply untouched; the
  [mock README](../../scripts/mock-llm/README.md) doesn't say these
  kinds apply in mock mode only. `piggybackNote` blames
  `taggedBlockReliable` when the fallback fires after an injected
  `malformed` or `length` cut inside `<state>`. The control UI's
  "a single injected failure is swallowed" hint also shows for an HTTP
  401 or 403, which the app doesn't retry. Raised by the cut-off
  replies Task 12 review.

- **A profile's `customJson` is never sent.** `resolveModel`
  (`lib/ai/resolve-model.ts`) carries a profile's `customJson` into the
  resolved params, and nothing reads it after that: `buildCallSettings`
  (`lib/ai/generate.ts`) maps only temperature, max output and the
  Anthropic-only thinking budget, for every provider. Canon calls it a
  per-field merge over the constructed payload
  ([`data-model.md`](../data-model.md)). On an OpenAI-compatible
  reasoning model nothing can then disable or cap thinking: the cut-off
  replies smoke on the dev LLM spent a narrative max output of 64, 512,
  1024 and 2200 entirely on reasoning, so every turn failed as cut off
  before any text until the limit (8192) covered the reasoning. Raised by
  the coordinator from the cut-off replies Task 15 smoke.

- **The orchestrator never fills a phase-logic error's `phaseName` or
  `retryAttempt`.** Canon has it fill both when it wraps a phase's
  error
  ([`generation-pipeline.md → Fatal error categories`](../generation-pipeline.md#fatal-error-categories)),
  but nothing in `lib/pipeline/runtime/orchestrator.ts` sets either,
  the `phase-logic` arm in `lib/pipeline/types.ts` has no
  `retryAttempt`, and `toPipelineError` drops a parse failure's
  `attempt`. Since the cut-off replies work, a pass's or a suggestion
  refresh's exhausted parse retries reach this bare arm, where they
  used to be relabelled `provider`. Raised by the cut-off replies slice
  review.

- **A narrative stream that ends without its final frame commits as
  finished.** Canon fails the phase on a mid-stream provider error
  ([`generation-pipeline.md → Streaming resilience — thin v1`](../generation-pipeline.md#streaming-resilience--thin-v1)),
  but when the SSE body just ends, with no finish frame and no
  `[DONE]`, the OpenAI-compatible provider raises nothing: it reports
  the finish reason as `other` and hands back the partial text (probed
  through the app's transport against the dev mock's `stream-cut`).
  The narrative phase reads anything but `length` as finished, so the
  truncated prose commits with no cut-off notice; read from
  `lib/pipeline/definitions/per-turn.ts`, not run end to end. The logger
  has no `stream_interrupted` kind either, though `observability.md`
  lists one. Raised by the cut-off replies slice review.

- **E2E entry-id helpers are copied per spec, and reader locators scope
  unevenly.** `entryIdByContent` and `pollEntryId` live in three specs
  (`reader-regenerate`, `periodic-classifier` and, since the cut-off
  replies work, `reader-failure-retry`), with different poll timeouts
  and a `page()` getter in one, so lifting them into
  `e2e/harness/db.ts` needs page and timeout parameters rather than a
  move. In `e2e/locators/reader.ts`, `dismissSystemEntry` is scoped to
  the entry rows while `retrySystemEntry`, `systemEntryFailure` and
  `fixProfile` match page-wide; `fixProfile`'s comment says to scope it
  to a row, and neither of its callers does. Playwright's strict mode fails
  loudly on a second match, so nothing passes by accident today. Raised
  by the cut-off replies slice review; the simplifier left the lift for
  a home. The context window check added a fourth copy
  (`context-window.spec.ts`), and `e2e/harness/seed.ts` now repeats
  its providers read-modify-write block three times
  (`setProviderEndpoint`, `addProviderCustomModel`,
  `setContextWindowOverride`).

- **Overflow recognition misses shapes beyond llama.cpp's and OpenAI's.**
  [`architecture.md → Recognizing an overflow rejection`](../architecture.md#recognizing-an-overflow-rejection)
  is verified against those two servers only. Recalled by the context
  window check's reviews and not checked against each server:
  Anthropic rejects a prompt plus `max_tokens` with "input length and
  `max_tokens` exceed context limit", and LM Studio says "context
  length"; neither matches a canon keyword, so both read as a plain
  provider failure. Gemini's OpenAI-compatible endpoint may wrap its
  error body in an array, which still matches by keyword but quotes the
  whole JSON as the provider's message. The capability hint matches any
  4xx, a 429 included, so an aggregator's rate-limit body that echoes a
  model id containing `thinking` or `reasoning` gets the hint and
  `Fix profile`. Reproduced through the real SDK (Task 10 review): an
  overflow sent as an in-stream error part, then a stall, fails the turn
  as a provider timeout, because an expired stream fails as a timeout
  ([`generation-pipeline.md → Two retry tiers, both at phase level`](../generation-pipeline.md#two-retry-tiers-both-at-phase-level));
  the servers above reject an overflow with a 400 before streaming.

- **The truncation cross-check may warn on every warm turn of a server
  that counts only uncached prompt tokens.** Canon names Ollama as a
  server that cuts prompts silently
  ([`architecture.md → Truncation cross-check`](../architecture.md#truncation-cross-check)).
  Nobody has checked whether its OpenAI-compatible `prompt_tokens`
  includes the KV-cache tokens it reused. If it doesn't, a cached story
  prefix puts the ratio under 0.5 on most turns: a warn log each call
  and a false toast once per model per session. llama.cpp counts them
  (`prompt_tokens` 913 with `cached_tokens` 908, Task 6 review). Raised
  by the context window check.

- **Detected windows on embedding models and parallel slots.** vLLM
  publishes `max_model_len` on an embedding model too, so the catalog
  now stores it as that model's `contextWindow`, while the embedder
  reads only `maxInputTokens` (`lib/embedder/input-window.ts`), whose
  schema comment says no OpenAI-compatible field publishes it. Whether
  the embedder falls back to the detected window is a canon question.
  Separately,
  [`architecture.md → Detection`](../architecture.md#detection) calls
  `meta.n_ctx` llama.cpp's per-slot size; on a server started with
  `--parallel N` and no unified KV cache it may be the total across
  slots, which overstates the window and ends in a recognized rejection
  rather than a refusal. The dev router runs `--parallel 1`, so this is
  unchecked. Raised by the context window check's Task 2 review.

- **A capability editor must store an explicit `false`.**
  `normalizeModelCatalog` (`lib/ai/catalog.ts`) lets a stored capability
  key, `false` included, beat detection, and re-detects a key the stored
  entry lacks on every fetch. The M7 settings editor must therefore
  write `false` to turn a detected flag off; deleting the key turns it
  back on at the next refresh. A code comment said so until the context
  window check compressed it; no canon does.

- **Window-failure copy has rough edges.** From the context window
  check's Task 11 and 12 reviews:
  - The provider's message is quoted in the entry's content, which
    renders through `marked`, so markdown in it (`*x*`, a `#` line)
    changes the quote. It is sanitized, so not a security issue.
  - The message shows twice: in the quote and in the muted detail line,
    `describeContextWindow`'s, which also shows the internal provider
    id.
  - A message that ends in a period renders as `….”.`.
  - `common:contextWindowSource.*` is a translated fragment slotted into
    sentences; a language with grammatical gender can't agree it with
    "window". i18next's `context` option would let each sentence carry
    its own wording.
  - The suggestion strip's and wizard-assist's window copy names no
    remedy, and Retry on a check refusal refuses the same prompt again;
    the turn entry's copy carries the remedies.
  - A hinted provider failure replaces "LLM call failed." with copy
    that starts "The provider rejected the request.", where
    [`reader-composer.md → Transient pipeline failures`](../ui/screens/reader-composer/reader-composer.md#transient-pipeline-failures--system-entries-in-chat)
    says the entry adds the hint.

- **The narrative reports every non-window stream error as `network`.**
  `lib/pipeline/definitions/per-turn.ts` maps a stream error to
  `reason: 'network'`, a 401 or 403 and other 4xx included, where
  `classifyProviderError` would give `auth` or `unknown`; the reader
  then shows "network: APICallError: Unauthorized". The context window
  check kept it, as a separate behaviour change. The provider `reason`
  union is also spelled twice, in
  `lib/ai/transport/classify-provider-error.ts` and
  `lib/pipeline/types.ts`, with nothing tying the copies together.

- **The E2E mock repeats the dev mock's helpers.**
  `e2e/harness/mock-llm.ts` has its own `promptText` (the dev mock's is
  in `scripts/mock-llm/routing.ts`), and both mocks' usage counts now
  depend on it, so they can drift apart. Its `cors` object repeats
  `CORS_HEADERS` from `scripts/mock-llm/respond/wire.ts`, its
  `JSON.parse` of a request body is unguarded (the dev mock answers a
  bad body with a 400), and its one-shot controls are never reset
  between tests in a describe, so one armed in a test that fails before
  its call carries into the next. Raised by the context window check's
  Task 14 review.

- **A cut-off's `window` cause reads the estimate, not the server's
  count.** `replyCutOff` (`lib/ai/reply-cut-off.ts`) gives `window` only
  when the o200k estimate plus the output reaches the figure
  ([`generation-pipeline.md → Cut-off replies`](../generation-pipeline.md#cut-off-replies)).
  On a model whose tokenizer counts above o200k, as Gemma 4 does English
  ([`parked.md`](../parked.md) records 6-7%), a genuinely full known
  window lands below the figure and reads `unknown`, and the notice
  points at `Fix profile`. With `includeUsage` on, a cut-off reply now
  usually carries the provider's own input count, which would make the
  cause exact. A canon design change. Raised by the context window
  check's Task 16 review.
