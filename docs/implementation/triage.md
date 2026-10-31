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

- **The `provider.*` log kinds in `observability.md` are stale.**
  [`observability.md`](../observability.md) lists `retry_succeeded`,
  `rate_limited`, `stream_interrupted`, `request_failed` and
  `url_redaction_failed`. The code also logs `http_call_buffer_full`,
  `narrative_stream_failed`, `wizard_assist_failed`,
  `wizard_assist_threw`, `wizard_opening_unresolved_refs` and four
  `setup_*` kinds, and logs no `rate_limited`, `stream_interrupted` or
  `request_failed` by those names. The cut-off replies PR adds its own
  `reply_cut_off`. Raised by the cut-off replies Task 4 review.

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

- **Overflow recognition misses shapes beyond llama.cpp's and OpenAI's.**
  [`architecture.md → Recognizing an overflow rejection`](../architecture.md#recognizing-an-overflow-rejection)
  is verified against those two servers only. Checked in SGLang's
  source (`tokenizer_manager.py`), a server canon names under
  [Detection](../architecture.md#detection): a prompt over its window
  is a 400 reading "The input (N tokens) is longer than the model's
  context length (M tokens).", which no canon keyword matches, so it
  reads as a plain provider failure. A "context length" keyword would
  catch it and LM Studio's wording, but may also catch a max-output
  rejection phrased against the context length, whose remedy is a lower
  max output, not a shorter prompt. Recalled by the context
  window check's reviews and not checked against each server:
  Anthropic rejects a prompt plus `max_tokens` with "input length and
  `max_tokens` exceed context limit", and LM Studio says "context
  length"; neither matches a canon keyword, so both read as a plain
  provider failure. `@ai-sdk/anthropic` sends the model's whole max
  output as `max_tokens` when the profile sets none, and Anthropic's
  docs say models from Claude 4.5 accept such a request and stop at the
  window (`model_context_window_exceeded`, read as a `length` cut-off),
  so only earlier models reject it. Gemini's OpenAI-compatible endpoint may wrap its
  error body in an array, which still matches by keyword but quotes the
  whole JSON as the provider's message. An overflow sent inside the
  stream after an HTTP 200 is never recognized:
  `@ai-sdk/openai-compatible` hands it over as a plain string, not an
  `APICallError`, so the turn fails as a provider `network` error, or,
  reproduced through the real SDK, as a provider timeout when a stall
  follows, because an expired stream fails as a timeout
  ([`generation-pipeline.md → Two retry tiers, both at phase level`](../generation-pipeline.md#two-retry-tiers-both-at-phase-level));
  the servers above reject an overflow with a 400 before streaming.
  Raised by the context window check.

- **The truncation cross-check may warn on every warm turn of a server
  that counts only uncached prompt tokens.** Canon names Ollama as a
  server that cuts prompts silently
  ([`architecture.md → Truncation cross-check`](../architecture.md#truncation-cross-check)).
  Nobody has checked whether its OpenAI-compatible `prompt_tokens`
  includes the KV-cache tokens it reused. If it doesn't, a cached story
  prefix puts the ratio under 0.5 on most turns: a warn log each call
  and a false toast once per model per session. llama.cpp counts them
  (`prompt_tokens` 913 with `cached_tokens` 908). Raised by the context
  window check.

- **A detected window on a `--parallel N` llama.cpp server.**
  [`architecture.md → Detection`](../architecture.md#detection) calls
  `meta.n_ctx` llama.cpp's per-slot size; on a server started with
  `--parallel N` and no unified KV cache it may be the total across
  slots, which overstates the window and ends in a recognized rejection
  rather than a refusal. The dev router runs `--parallel 1`, so this is
  unchecked. Raised by the context window check.

- **Window-failure copy has rough edges.** From the context window
  check's reviews:
  - The provider's message is quoted in the entry's content, which
    renders through `marked`, so markdown in it (`*x*`, a `#` line)
    changes the quote. It is sanitized, so not a security issue.
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
  - The truncation toast names only the model, while it shows once per
    provider and model, so one model id on two providers can show two
    identical toasts.

- **A cut-off's `window` cause reads the estimate, not the server's
  count.** `replyCutOff` (`lib/ai/reply-cut-off.ts`) gives `window` only
  when the o200k estimate plus the output reaches the figure
  ([`generation-pipeline.md → Cut-off replies`](../generation-pipeline.md#cut-off-replies)).
  On a model whose tokenizer counts above o200k, as Gemma 4 does English
  ([`parked.md → Calibrating the token estimate per model`](../parked.md#calibrating-the-token-estimate-per-model)
  records 6-7%), a genuinely full known
  window lands below the figure and reads `unknown`, and the notice
  points at `Fix profile`, which the roadmap's M7.1 item on a cut-off
  under a story's model override already revisits. On one that counts
  below it, as Gemma 4 does Japanese (25%), a stop at the server's own
  default can reach the figure and read `window`, whose notice offers no
  action until M7.1 wires `Set window`. With `includeUsage` on, a cut-off reply now
  usually carries the provider's own input count, which would make the
  cause exact. A canon design change. Raised by the context window
  check.

- **The stored system-failure shape is looser than the data model.**
  `systemFailure` in `lib/db/story-entries/entry-metadata.ts` parses on
  any entry kind, while
  [`data-model.md → Entry metadata shape`](../data-model.md#entry-metadata-shape)
  puts it only on `kind: 'system'`, and `pass: 'resolved'` parses
  without a `submission`, while the data model calls a resolved entry a
  notice holding the text. The writers are already tight
  (`passResolvedEntry` takes a non-null submission) and the reader guards
  on `kind === 'system'`, but a resolved row read back without text would
  show "so it's kept here" over no quote. Older code; raised by the
  held-text slice review's type-design pass.

- **`JSONBlock`'s copy fails silently.** `components/ui/json-block.tsx`
  writes the clipboard with `.catch(() => {})` on both platforms and
  gives no feedback either way, while a system entry's copy
  (`components/reader/copy-system-text.ts`) toasts its outcome. Canon
  ([`data.md`](../ui/patterns/data.md)) doesn't say what the Diagnostics
  copy confirms. Raised by the held-text slice review.

- **Two shapes the held-text slice review's simplifier left for a
  home.**
  - Three sites split the clipboard into web `navigator.clipboard` and
    native `expo-clipboard` on their own: `copySystemText`'s writer,
    `JSONBlock`'s copy and `ImportDialog`'s read
    (`components/compounds/import-dialog.tsx`). A `lib/clipboard`
    module with a read and a write would hold one copy. The writers'
    failure policies differ (see the `JSONBlock` entry above), and
    the system copy's `reader.clipboard_unavailable` warning names its
    subsystem, so sharing is a decision, not a dedupe.
  - `TextToggle` (`components/compounds/entry-card-system.tsx`) and the
    cut-off notice's fix link in `entry-card.tsx` share a link-button
    shape: a named group, the web cursor and outline reset, a focus
    ring on the inner text, and phone tap padding cancelled by
    margins. Two uses don't pay for a primitive; a third link-style
    button is the signal to extract one.

- **`ClassifierWindow` doesn't tie `turns` to `isEmpty`.** The two are
  separate fields (`lib/classifier/window.ts`), so a caller reads
  `turns[0]!` on the strength of an `isEmpty` early return several
  lines up (`periodic-classifier.ts`, the classifier probe), and
  `plan.ts` falls back with `turns[0]?.entryId ?? ''`. A union
  (`{ isEmpty: true; turns: readonly [] }` or a non-empty tuple
  otherwise) makes the guard the type's. Raised by the Known
  happenings slice review.
