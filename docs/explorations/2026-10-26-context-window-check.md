# Context window check

Every generation call is checked against its model's context window
before it is sent, a provider's overflow rejection is recognized as
one, and a prompt the server silently cut is caught afterwards. The
window is a figure per model that the user declares, pre-filled only
where a server publishes it unambiguously. Designed 2026-10-26; closes
the [followup](../followups.md#data-model) "Generation prompts aren't
checked against the model's window".

## Why

Nothing compares a prompt against the model's window: `maxInputTokens`
is read by the embedder only. Retrieval tuning will raise the budgets
severalfold, which makes an overflow likelier, and today one surfaces
as a raw provider string under `provider/unknown`, or not at all on a
server that truncates silently. The hard part is the window figure,
not the comparison: OpenAI-compatible endpoints, the common case, have
no standard field for it.

## Ground truth that shaped it

- **The app reads only `id` from `/models`**
  (`lib/ai/catalog.ts`), and the catalog merge lets a stored capability
  key win over a fresh detection, so a detected value and a user value
  are indistinguishable. A model missing from one fetch loses its
  `cachedModels` entry. Hand-added ids carry no capabilities.
- **Only `anthropic` and `openai-compatible` are implemented**
  (`lib/ai/providers.ts`); OpenRouter, NanoGPT and NIM users come in
  through `openai-compatible`, so detection can't key on provider type.
- **The obvious field lies.** The dev llama.cpp router reports
  `context_length: 262144` (the trained maximum) while it runs
  `--ctx-size 65536`; the enforced figure is `meta.n_ctx`, the per-slot
  size (`server-context.cpp:5504`), present only on a loaded model.
- **What servers publish** (a research pass over source code and docs,
  2026-10-26; llama.cpp and vLLM spot-checked in source, the rest not):
  - enforced figures on `/models`: llama.cpp `meta.n_ctx`, vLLM and
    SGLang `max_model_len`, a loaded TabbyAPI entry, Anthropic
    `max_input_tokens`, DeepSeek `context_window`;
  - `context_length` means the trained maximum on local servers and the
    served limit on hosted catalogs; Anthropic's docs example shows
    `0`; Fireworks advertised 128k for a model it capped at 32k;
  - about 12 targets put the limit in the overflow error, most
    reliably classified by code (`context_length_exceeded`,
    `exceed_context_size_error`); only llama.cpp returns it as JSON
    fields;
  - silent truncation by default: Ollama (whose `/v1` can't set
    `num_ctx`), KoboldCpp, text-generation-webui, likely LM Studio,
    and OpenRouter on endpoints of 8k or less;
  - several servers check the prompt alone and stop the reply at the
    window (llama.cpp, TabbyAPI, vLLM main, Anthropic 4.5+); others
    reject prompt plus `max_tokens` over it (OpenAI, DeepSeek,
    Together, SGLang, older vLLM).
- **Estimate against real count, measured on Gemma 4** via the dev
  router's `/tokenize`: English prose and the bundled prompt snapshots
  count 6 to 7% more under Gemma than under o200k; Czech, German and
  Russian within 4%; Japanese 25% fewer. Counting a 66k-token prompt
  takes about 55 ms on desktop Node 24; Hermes is unmeasured.
- **Streamed usage is never requested.** `@ai-sdk/openai-compatible`
  sends `stream_options.include_usage` only when the provider is built
  with `includeUsage`, which `lib/ai/providers.ts` doesn't set, so a
  streamed turn on most OpenAI-compatible servers records its prompt
  tokens as `0` (`per-turn.ts`, `usage.inputTokens ?? 0`). The SDK's
  `inputTokens.total` does include cached tokens on both paths.
- **Nothing reads `finish_reason`.** A reply stopped by the window
  commits as complete; a structured reply cut short fails as a parse
  failure.
- **`possibleCapabilityMismatch` has no code.** Canon describes the
  provider-error mapper as existing; nothing in `lib/` implements it.

## Decisions

**Scope: the figure and the check.** Window-relative budgets, canon's
[floor-then-reservation-then-budgets accounting](../memory/retrieval.md#structural-floor-takes-budget-first),
stay with the roadmap's M7.2 entry: retrieval runs before the prompt is assembled, so they are
a design of their own. The per-turn token breakdown stays its own
followup; it shares only per-section counting, which this design
doesn't need.

**Declared figure, narrow pre-fill, recognized rejections.** The user
declares the window; detection only pre-fills it from fields whose
name means the enforced limit on every server that uses it; a rejection
is recognized, never parsed. Rejected:

- _A detection ladder_: fingerprinting servers, reading each one's
  native route (Ollama `/api/ps`, LM Studio `/api/v0/models`) and
  parsing limits out of rejections. It is the only option that reaches
  the silent truncators, at the price of about ten adapters that drift
  between releases (vLLM's message changed three times), loaded-only
  fields, and parse errors that yield a figure too low, which then
  refuses working calls.
- _Declared only_: users of vLLM, llama.cpp and Anthropic would type a
  number their server already publishes correctly.

**A hard stop.** A prompt over the figure is refused, not trimmed.
Fitting the prompt to the figure is the M7.2 accounting. A figure set
below the model's maximum, as a cost ceiling, therefore stops turns
once the story outgrows it rather than making them cheaper; the remedy
is manual.

**Per model, not per profile.** The window is a fact about the model.
A story override swaps a profile's model, so a figure kept on the
profile would follow it to a model it was never set for. A lowered
figure caps every role on that model.

**The prompt alone, no reply reserve.** Reserving `maxOutput` treats a
ceiling as a need: a 16k `maxOutput` on a 32k llama.cpp model works
today, the reply stopping at the window, and with a detected figure
every prompt over 16k would be refused. Servers that check prompt plus
`max_tokens` reject such a call themselves, and the rejection is
recognized. Lowering `max_tokens` to the room left was rejected: it
rewrites the user's request and breaks Anthropic thinking, whose budget
must stay below `max_tokens`.

**No margin, ratio logged.** The estimate's error has no known
direction per model; a false refusal is a hard stop, a false pass
falls back to a recognized rejection or a small truncation, so the
comparison takes the estimate as it is. Every call logs the provider's
count against the estimate, so a calibration has evidence to start
from.

**The cross-check, with usage always on.** Silent truncation hides its
own evidence, so waiting for a report doesn't work. `includeUsage` is
set on every OpenAI-compatible provider; a server that rejects
`stream_options` would fail every streamed turn, and no researched
server does, so the toggle waits for a report.

## The design

Canonical in
[`architecture.md → Model context window`](../architecture.md#model-context-window):
[the window figure](../architecture.md#the-window-figure),
[detection](../architecture.md#detection),
[the pre-send check](../architecture.md#the-pre-send-check),
[recognizing an overflow rejection](../architecture.md#recognizing-an-overflow-rejection)
and the [truncation cross-check](../architecture.md#truncation-cross-check).
Storage in
[`data-model.md → App settings storage`](../data-model.md#app-settings-storage),
the failure type in
[`generation-pipeline.md → Fatal error categories`](../generation-pipeline.md#fatal-error-categories),
the surfaces in
[`app-settings.md → Context window`](../ui/screens/app-settings/app-settings.md#context-window)
and
[`reader-composer.md → Transient pipeline failures`](../ui/screens/reader-composer/reader-composer.md#transient-pipeline-failures--system-entries-in-chat).

## Adversarial pass

- **The estimate is load-bearing.** On Gemma 4, English passes up to
  about 7% over the window (llama.cpp then rejects it, recognized) and
  a 7% silent cut stays under the cross-check; Japanese is refused up
  to 25% early, and the only workaround is a figure above the true
  one. Calibration is parked with the logged ratio as its signal. One
  tokenizer was measured.
- **A reply with no room.** With the prompt alone checked, a prompt
  just under the window leaves the reply little room; nothing reads
  `finish_reason`, so prose commits cut short and a structured reply
  fails as a parse failure. Pre-existing; a followup.
- **Cost.** About 55 ms for 66k tokens on desktop; Android unmeasured,
  likely a few hundred ms on the largest prompts. Retrieval already
  builds the encoder, so a turn pays no start-up; wizard-assist may.
- **Edge cases that hold**: unknown windows (wizard-assist, the stub
  provider, a never-fetched catalog) skip the check but keep
  recognition and the cross-check; overrides to another model and one
  model id on two instances resolve per model and instance; a deleted
  provider takes its overrides; optional JSON keys need no migration
  and older backups parse; a router model gets its figure at the first
  refresh while loaded; `catalogSchema` strips unknown keys, so
  detection passes each entry's raw fields through.
- **Canon to correct**: the
  [trust-the-user rule](../ui/screens/app-settings/app-settings.md#override-semantic--trust-the-user)'s
  "no runtime pre-check" is about capability flags;
  [`retrieval.md`](../memory/retrieval.md#capability-flags--provider-side)
  says `/v1/models` carries only id, object, created and owned_by,
  false for llama.cpp and vLLM.
- **Unverified**: Hermes timing; the hosted servers' messages,
  second-hand. Verified after the drift pass: `ai` 6.0.193 maps the
  top-level `usage.inputTokens` to the provider's `inputTokens.total`.

## Integration plan

- `architecture.md`: the `## Model context window` section, after
  Agent orchestration; the intro's list of covered pieces.
- `data-model.md → App settings storage`: `contextWindow` on
  capabilities, `contextWindowOverrides` on the provider, and the
  embedder's `maxInputTokens`, which the block lacked.
- `generation-pipeline.md`: the `context-window` arm on
  `CallRetryError` and `PipelineError` with `ContextWindowFailure`;
  Two retry tiers and Fatal error categories.
- `memory/retrieval.md → Capability flags — provider-side`: the
  `/v1/models` sentence corrected, `contextWindow` in the type block.
- `ui/screens/app-settings/app-settings.md` and `.html`: the Context
  window subsection, the chip in the Providers sketch and row actions,
  the profile line under max output, the override semantic scoped to
  capability flags, the OpenAI-compatible bullet, Popover in the
  patterns list. The wireframe shows the chip's three states, its
  popover, and the profile line.
- `ui/screens/reader-composer/reader-composer.md` and `.html`: the
  system-entry row and its text; the wireframe's window, provider
  overflow and pass variants, and the truncation toast.
- `ui/patterns/toast.md` and `ui/patterns/overlays.md`: Used by.
- `implementation/roadmap.md`: M7.1's providers tab scope; M7.2's
  window-accounting note.
- `followups.md`: the followup replaced by "Implement the context
  window check"; "Nothing reads a reply's `finish_reason`" added; the
  token breakdown and retrieval tuning entries amended.
- `parked.md`: calibrating the token estimate per model, a
  per-provider switch for stream usage, pre-filling the embedder's
  window from the catalog.
- `implementation/triage.md`: `possibleCapabilityMismatch` is canon
  without code.
- `README.md`: the architecture entry.
