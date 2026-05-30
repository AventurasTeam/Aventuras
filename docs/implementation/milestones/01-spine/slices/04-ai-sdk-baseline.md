# Slice 1.4 — Vercel AI SDK baseline

## Metadata

- **Milestone:** [Milestone 1 — Spine](../milestone.md)
- **Depends on:** [Slice 1.3](./03-observability-foundations.md)
  — `httpCallSink` slice is declared empty in 1.3; this slice
  populates it. AI SDK calls route through `logger` from their
  first commit.
- **Blocks:** Slice 1.5 — the pipeline framework's stub LLM
  needs the provider abstraction even when the call is faked,
  and the orchestrator's ambient `actionId` mechanism reads
  from the sink-aware ID slot wired here.

## Goal

Lay down the AI SDK integration layer as `lib/ai/`, the third
`lib/*` module. By the end of this slice the project has a
typed `getModel(providerId, modelId)` abstraction over the
Vercel AI SDK, every outbound HTTP request goes through a
fetch wrapper that captures the call into `httpCallSink`, and
the `httpCallSink` itself is fully implemented (beginCall /
completeCall / failCall, ring buffer, value-matching header
redaction at the sink boundary). One provider type
(Anthropic) is wired through end-to-end to prove the
abstraction works; other provider types land as real features
need them.

## Background

Milestone 1 doesn't make real LLM calls — slice 1.5 ships a
fault-injectable stub at the pipeline layer that bypasses real
providers. So slice 1.4's job is to put the production HTTP and
provider plumbing in place such that when slice 1.5's stub is
swapped for real calls in later milestones, no scaffolding
needs to be retrofitted.

The HTTP capture pattern follows the observability spec
literally: the wrapper allocates an ID at `beginCall`, holds it
locally between begin and complete / fail, accumulates streaming
bodies internally, and emits one `completeCall` at stream end
with the final body and `streamed: true`. No event-bus routing,
no incremental store updates during streaming — diagnostics is a
parallel concern routed through direct sink calls.

Header redaction happens at the sink boundary, never at the
call site. API keys exist unredacted only inside the wrapper's
local scope during a single request's lifecycle; they never
reach the Zustand store, so they can't leak via screenshot,
export, or shared session view. Redaction is **value-matching**
against the known key set from `app_settings.providers` — no
denylist of header names, no per-provider auth-header
enumeration, no maintenance burden as new providers ship. Exact
match (after stripping auth-scheme prefixes like `'Bearer '`)
to stay safe for local-server short keys.

## Required reading

- [`docs/observability.md` → `httpCallSink`](../../../../observability.md#httpcallsink)
  — the sink contract, record shape, beginCall / completeCall /
  failCall surfaces.
- [`docs/observability.md` → Pairing](../../../../observability.md#pairing)
  — wrapper-holds-id pattern; no correlation logic in the sink.
- [`docs/observability.md` → Streaming](../../../../observability.md#streaming)
  — body accumulation inside the wrapper; single completeCall
  at stream end.
- [`docs/observability.md` → Ring buffer behavior](../../../../observability.md#ring-buffer-behavior)
  — eviction rules, in-flight protection, turn-resident
  protection.
- [`docs/observability.md` → Header redaction](../../../../observability.md#header-redaction)
  — denylist, build-time completeness test, dev-build runtime
  heuristic warning.
- [`docs/observability.md` → Performance budget](../../../../observability.md#performance-budget)
  — target overhead for `beginCall` / `completeCall`.
- [`docs/data-model.md` → App settings storage](../../../../data-model.md#app-settings-storage)
  — `app_settings.providers` shape; provider instances are
  user-managed and reference `type` (anthropic / openai /
  google / openrouter / nanogpt / nvidia-nim / openai-compatible).

## Scope: in

- Add `ai` (Vercel AI SDK core) and `@ai-sdk/anthropic` to
  project dependencies. Other `@ai-sdk/*` providers land with
  the features that need them.
- Create `lib/ai/` as the third `lib/*` module under Slice 1.1's
  discipline:
  - **Public API in `index.ts`**: `getModel(providerId,
modelId): LanguageModelV1` — given a provider instance ID
    from `app_settings.providers` and a model ID, returns an
    AI SDK `LanguageModelV1`. Internal lookup reads from
    `lib/db` via the appSettings table, instantiates the
    matching `@ai-sdk/<type>` provider with the stored apiKey
    and endpoint, and returns `provider(modelId)`.
  - Internal organization: implementer's call. Likely shape:
    `model.ts` (the getModel function), `providers.ts`
    (provider-type-to-SDK mapping), `fetch.ts` (the
    fetchWithCapture wrapper), `redaction.ts` (value-matching
    redaction against the known key set + prefix stripping).
- Implement `fetchWithCapture` inside `lib/ai/`:
  - Wraps native `fetch`. Allocates an ID via
    `httpCallSink.beginCall` before the call; on success calls
    `completeCall` with status, headers, and final body
    (accumulated for streams); on error calls `failCall`.
  - Reads ambient `actionId` if available (the mechanism lands
    in slice 1.5; until then `actionId` is undefined and the
    sink handles undefined gracefully).
  - Accepts a `source` argument (e.g. `'provider:<id>'`) so the
    `HttpCall` record's `source` field is populated. Wrapper
    needs a thin layer that lets callers inject the source per
    call since AI SDK's `customFetch` doesn't pass arbitrary
    metadata; likely a per-provider closure that pre-binds
    source.
- Pass `fetchWithCapture` into AI SDK calls as the `customFetch`
  option on the provider factory or per-call options.
- Implement `httpCallSink` in `lib/diagnostics/` (the
  declared-empty slice from 1.3):
  - `beginCall` allocates a ULID, builds the in-flight
    `HttpCall` row with redacted headers, appends to the
    `httpCalls` ring buffer.
  - `completeCall` looks up the row by ID, mutates in place to
    `state: 'completed'` with status / response headers
    (redacted) / response body / streamed flag / durationMs.
    Row identity stays stable so React keys don't churn.
  - `failCall` mutates the row to `state: 'failed'` with error
    string.
  - Ring buffer capped at 200 entries; eviction protects
    in-flight entries and completed entries whose `actionId`
    is still resident in `turnCaptures` (the cross-tab nav
    contract). Slice 1.5 wires the `turnCaptures` resident set;
    until then, the protection just degrades to FIFO over
    completed rows.
- Value-matching header redaction:
  - `getKnownApiKeys()` selector on the `app_settings.providers`
    store returns a `Set<string>` of all current `apiKey` values;
    refreshes on settings change.
  - `redactHeaderValue(value)` exact-matches `value` against the
    set; if no match, strips known auth-scheme prefixes
    (`'Bearer '`, `'Basic '`, `'Token '`) and exact-matches the
    remainder. Returns `'***'` on match, `value` otherwise.
  - URL query strings get the same treatment: parse, exact-match
    each parameter value, redact in place. Body redaction is
    out of scope (provider SDKs don't put keys in bodies).
  - Response headers pass through; `set-cookie` from provider
    endpoints belongs to provider session management and is not
    OUR secret.
- Add the `provider.*` subsystem prefix to `LogSubsystem` if it
  isn't already in the union from slice 1.3 (the spec lists
  `provider` as one of the eight initial members — confirm
  during authoring).

## Scope: out

- Real LLM calls from milestone-1 user flows. Slice 1.5's stub
  LLM is what milestone-1's smoke triggers; this slice only
  ships the production plumbing.
- Multi-provider support beyond Anthropic. OpenAI / Google /
  OpenRouter / NanoGPT / NVIDIA NIM / openai-compatible all
  land as the features needing them ship. The abstraction is
  designed to make adding them a one-line entry in the
  provider-type-to-SDK map.
- Provider settings UI (Add / Edit provider instance, API key
  entry, capability detection). Settings shells in slice 1.7
  render layout only; provider config UI lands in a later
  milestone.
- `/models` endpoint fetching for capability detection. Out of
  scope; lands when the Provider Picker UI needs cached models.
- Embedder integration. The embedder is a future milestone; its
  HTTP calls will also flow through `fetchWithCapture` when
  built.
- Translation, classifier, suggestion, lore-mgmt, retrieval,
  wizard-assist agents. They wire to providers via the same
  abstraction once their orchestration lands.
- Memory probe persistent capture. Unrelated to this slice.

## Acceptance criteria

- `lib/ai/` exists under the public-API discipline; only
  `index.ts` is reachable from outside the module.
- `ai` + `@ai-sdk/anthropic` installed and locked.
- `getModel(providerId, modelId)` returns a valid
  `LanguageModelV1` for an Anthropic-typed provider instance in
  `app_settings.providers`; throws or returns a clear error for
  unsupported types.
- `fetchWithCapture` wraps every outbound call from the AI SDK
  through `httpCallSink`. Non-AI fetch is unchanged.
- `httpCallSink` is fully implemented: beginCall / completeCall
  / failCall mutate the ring buffer with stable row IDs.
- Value-matching redaction catches the configured Anthropic
  provider's `apiKey` in any outbound header — raw value,
  `'Bearer '`-prefixed, and URL query string — and replaces it
  with `'***'` before store-write.
- Local-server short-key safety: a configured provider with
  `apiKey: '123'` does NOT cause false redaction of headers like
  `content-length: 12345` (exact-match, not substring).
- Ring buffer eviction at cap 200: in-flight rows are
  protected; FIFO over completed rows.
- `pnpm lint` passes (boundaries plus console ban).
- `pnpm lint:docs` passes.
- Vitest suite covers all of the above.

## Tests

- **beginCall / completeCall / failCall roundtrips.** Three
  vitest scenarios, one per terminal state. Assert state
  transitions, durationMs computation, and ULID stability across
  the transition.
- **Streaming.** Simulate a streaming response (mock the fetch
  Response with a ReadableStream); assert no incremental sink
  updates during the stream and one `completeCall` at stream
  end with `streamed: true` and full concatenated body.
- **Value-matching redaction — standard cases.** Configure a
  provider with `apiKey: 'sk-test-abc...'`. Send three request
  variants:
  - `x-api-key: sk-test-abc...` — assert stored row has `'***'`.
  - `authorization: Bearer sk-test-abc...` — assert prefix
    stripped, value matched, stored as `'***'`.
  - `x-corp-grant: sk-test-abc...` (custom header name) —
    assert match by value regardless of name, stored as
    `'***'`. Benign `content-type` header preserves verbatim
    in all three cases.
- **Query-string redaction.** URL `https://example/?api_key=sk-test-abc...`;
  assert stored URL has `api_key=***`.
- **Short-key safety (local server).** Configure provider with
  `apiKey: '123'`. Send request with `content-length: 12345`,
  `authorization: Bearer 123`, and `x-request-id: req-123-abc`.
  Assert: `authorization` header redacted to `'***'` (exact-match
  after prefix strip catches the `123`), but `content-length`
  and `x-request-id` preserved verbatim (no substring match).
- **Key-set refresh.** Mutate `app_settings.providers` to add /
  rotate a key; assert subsequent requests use the refreshed
  comparator (new key matches, old key does not).
- **Ring buffer eviction.** Fill `httpCalls` to cap with a mix
  of in-flight and completed rows; allocate one more; assert
  the oldest completed (non-in-flight) row evicts and the
  in-flight rows persist.
- **Provider abstraction.** `getModel(providerId, modelId)` for
  an Anthropic provider returns a `LanguageModelV1` (probably
  asserted by structural type check rather than runtime
  behavior, since no real call is made). Unsupported provider
  type throws.
- **Public-API surface.** Fixture outside the module imports
  only via `lib/ai/index.ts`; deep-import attempt fails lint.

## Open questions

- **`source` injection through AI SDK's `customFetch`.** AI
  SDK's `customFetch` signature doesn't carry arbitrary
  metadata. Cleanest implementation likely binds the source via
  closure when constructing the per-provider fetch wrapper:
  `getModel(...)` builds a `fetchWithCapture` instance with
  `source: 'provider:<providerId>'` pre-bound, then passes it
  to the AI SDK. Confirm during authoring; alternative is a
  module-level ambient source register similar to ambient
  actionId, but that's heavier for a value that's known at
  provider-construction time.
- **Turn-resident protection without `turnCaptures`.** The
  spec's ring buffer eviction protects completed rows whose
  `actionId` is still in `turnCaptures`. Slice 1.5 ships
  `turnCaptures`; until then, the protection is a no-op and
  eviction is plain FIFO over completed rows. Acceptable for
  this slice; protection becomes load-bearing once
  `turnCaptures` populates.
- **Per-provider auth-header registration.** Each `@ai-sdk/*`
  package authenticates differently (Anthropic uses
  `x-api-key`, OpenAI uses `Authorization: Bearer`, etc.). The
  build-time denylist test needs a known mapping per provider
  type. For this slice, hand-encode Anthropic's; OpenAI's lands
  with `@ai-sdk/openai`; further providers add as they're
  installed. Acceptable as long as the mapping is co-located
  with the provider import (so adding a provider without
  updating the denylist is mechanically catchable).
- **Anthropic SDK version.** AI SDK provider packages version
  independently; pin to a specific minor at first install to
  avoid surprise upgrades during early milestones. Confirm
  versioning policy at authoring time.

## Implementation notes

- Targeted stable AI SDK 6 APIs: `getModel(...)` returns `LanguageModel`
  from `ai`, and Anthropic providers are created with `createAnthropic`
  plus the stable custom `fetch` option. Earlier `LanguageModelV1` /
  `customFetch` wording in the slice brief was stale.
- Header redaction uses value-matching only. The older per-provider
  auth-header registration question was stale after
  `docs/observability.md` moved to matching known secret values at the
  sink boundary.
- M1.4 intentionally uses an internal temporary provider/key registry in
  `lib/ai` instead of reading `app_settings.providers` directly. Slice
  1.6 must replace that registry source with hydrated app-settings store
  access and keep feeding the diagnostics secret set for redaction.
