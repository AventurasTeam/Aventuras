# Slice 2.1 — Provider abstraction: OAI-compat, resolution chain, config mutators

## Metadata

- **Milestone:** [Milestone 2 — First user loop](../milestone.md)
- **Depends on:** none (M1 `lib/ai` + M1.5 config types / Zod are
  shipped substrate)
- **Blocks:** [Slice 2.3](./03-wizard.md) (wizard-assist calls),
  [Slice 2.7](./07-wiring.md) (real provider swap)

## Goal

Replace M1's temporary provider seam with the real thing: an
OpenAI-compatible provider implementation, the
agent→profile→provider resolution chain (`resolveModel`), the
provider-config **mutators** that the M1.5 gate deliberately
excluded, a deliberately plain interim provider-setup form so a
user can configure the loop before the M7.1 providers tab exists,
and the `callWithRetry` hardening (SDK call config + Retry-After
backoff + the `CallRetryError → PipelineError` mapping promoted to
a shipped helper).

## Background

M1.4 shipped the provider abstraction as a stub:
`lib/ai/model.ts` resolves only an explicit `providerId` +
`modelId` through the `findTemporaryProvider` dev seam, and the
fetch wrapper already routes through `httpCallSink` with
value-matching redaction. M1.5 landed the full `app_settings`
config Zod (providers, profiles, assignments, capability flags)
but no write path. OAI-compat goes first because it is the most
universal provider type and covers the contributor test cases;
other provider types add incrementally in M7 alongside the
providers settings tab. The interim form exists because the M2
definition of done requires a _user_ to complete the loop and the
"AI not configured" banner CTA needs a real target.

## Required reading

- [`data-model.md → App settings storage`](../../../../data-model.md#app-settings-storage)
  — providers / profiles / assignments shapes, `modelRef`
  composite, deletion semantics, the `PROVIDER_DEFAULTS` seed
  constant (undefined for `openai-compatible`).
- [`architecture.md → Settings: strict types, defaults at load`](../../../../architecture.md#settings-strict-types-defaults-at-load)
  — the models resolver as the one sanctioned `??`-free fallback
  walk; override-at-render vs copy-at-creation.
- [`generation-pipeline.md → Two retry tiers, both at phase level`](../../../../generation-pipeline.md#two-retry-tiers-both-at-phase-level)
  — `callWithRetry` contract, `CallRetryError` vocabulary, the
  mapping boundary to `PipelineError`.
- [`generation-pipeline.md → Fatal error categories`](../../../../generation-pipeline.md#fatal-error-categories)
  — the `PipelineError` shape the mapping targets.
- [`observability.md → Header redaction`](../../../../observability.md#header-redaction)
  — value-matching redaction the OAI-compat scenarios extend.
- [`ui/patterns/banners.md → Variants`](../../../../ui/patterns/banners.md#variants)
  — the "AI not configured" banner whose CTA this slice's form
  becomes the target of.
- [`tech-stack.md`](../../../../tech-stack.md) — SDK layering and
  per-provider packages (Vercel AI SDK entry).

## Scope: in

- **OAI-compat provider implementation** in `lib/ai`: chat
  completions + streaming against a user-supplied `endpoint` +
  `apiKey`, routed through the existing fetch wrapper so every
  call lands in `httpCallSink`. `/models` catalog fetch writing
  `cachedModels` + `cachedAt`; `customModelIds` honored for
  endpoints without a usable catalog.
- **Resolution chain.** `resolveModel(agentId | 'narrative')`
  walking story-override → assignment → profile → provider per
  C3 in [the milestone doc](../milestone.md#c3--model-resolution-surface);
  typed failure per missing link. Replaces the
  `findTemporaryProvider` call in `lib/ai/model.ts` (the seam
  itself is removed in [Slice 2.7](./07-wiring.md)).
- **Provider-config mutators** in the action layer
  (settings-style writes, not delta-logged): add / update an
  OAI-compat provider instance, create / update profiles
  (narrative + agent), write `assignments`, set
  `default_provider_id`. Zod-validated against the M1.5 schemas
  at the write boundary.
- **Interim provider-setup form** on the existing app-settings
  screen: add / edit a single OAI-compat provider (display name,
  endpoint, API key), trigger the `/models` fetch or enter a
  custom model id, pick a model (shipped `ProviderModelPicker`),
  and a one-control "use this model for narrative and agent
  tasks" action that writes the narrative profile, one agent
  profile, and the `wizard-assist` assignment. Visually plain;
  explicitly superseded by M7.1. The "AI not configured" banner
  CTA routes here until M7.1 re-points it.
- **`callWithRetry` hardening:** `maxRetries: 0` on SDK calls
  (`callWithRetry` is the sole retry authority), SDK-native
  `timeout` (`totalMs` / `stepMs`, `chunkMs` for streams) instead
  of a fetch-level timeout, Retry-After-aware backoff (suppressing
  SDK retries also drops its exponential backoff), and the
  `CallRetryError → PipelineError` mapping promoted from the
  Slice 1.5b test-only helper to a shipped one.
- **Redaction suite extension:** OAI-compat scenarios added to
  the M1.4 vitest suite — the key in `Authorization: Bearer`,
  non-standard auth header names, and query-string placement;
  value-match must catch all without per-provider configuration.

## Scope: out

- Other provider types (anthropic / openai / google / openrouter /
  nanogpt / nvidia-nim) — M7.1.
- Provider deletion and its blocking semantics, capability-badge
  detection / override UX, per-section refresh, the full
  providers tab — M7.1 / M7.6.
- Onboarding flow — M7.4.
- Embedder configuration of any kind — M3.1.
- The `registerStubProvider()` seam removal — Slice 2.7 (the stub
  must survive until the reader's trigger path swaps over).

## Acceptance criteria

- From a clean database, a user can add an OAI-compat provider in
  the interim form, pick a model, apply the quick-wire action, and
  `resolveModel('narrative')` + `resolveModel('wizard-assist')`
  both return that model — verified by a vitest exercising the
  mutators + resolver against an in-memory DB, and manually
  against a real endpoint.
- `resolveModel` returns the typed failure naming the first
  missing link for each of: unset assignment
  (`no-profile-assigned`), assignment to a deleted profile id
  (`profile-missing`), profile whose `modelRef.providerId`
  matches no provider (`provider-missing`) — the C3 literals.
- Story-override precedence: with
  `stories.settings.models[agentId]` set, `resolveModel` returns
  the override model id without consulting the assignment walk.
- SDK calls carry `maxRetries: 0` and the SDK-native timeout
  config; a mocked 429 with `Retry-After` delays the next
  `callWithRetry` attempt accordingly (fake timers).
- The extended redaction suite passes; no raw key appears in any
  `httpCallSink` entry produced by an OAI-compat call.
- The "AI not configured" banner renders on the story list when
  `providers` is empty and its CTA lands on the interim form.
- Every user-visible string in the interim form routes through
  `t()` — no hardcoded literals in the render path.
- `pnpm lint`, `pnpm typecheck`, full vitest suite green.

## Tests

- **Resolution chain unit tests** — happy walk, each failure
  link, story-override precedence (override is a bare model id;
  no provider component).
- **Mutator round-trips** — provider / profile / assignment
  writes parse back through the M1.5 Zod; invalid shapes
  rejected at the boundary.
- **`callWithRetry`** — Retry-After honored, provider vs parse
  tier classification, abort mid-backoff; mapping helper
  produces the right `PipelineError` kind per `CallRetryError`.
- **SDK call config** — spy on the call options and assert
  `maxRetries: 0` plus the `totalMs` / `stepMs` / `chunkMs`
  timeout fields are passed as configured.
- **Redaction** — OAI-compat scenario block in the existing
  suite.
- **Storybook** — interim-form states (empty / populated /
  catalog-fetching / custom-id / quick-wire applied).
- **Manual smoke** — real OAI-compat endpoint (contributor test
  cases) on desktop; one streamed call captured in
  `httpCallSink`.

## Open questions

None outstanding — both planning questions resolved (see Implementation
notes): the OAI-compat SDK package, and single-vs-multi provider instance
in the interim form.

## Implementation notes

- **OAI-compat is backed by `@ai-sdk/openai-compatible`
  (`createOpenAICompatible`), not `@ai-sdk/openai` + `baseURL`.** It is
  purpose-built for arbitrary user-supplied `{ name, apiKey, baseURL,
fetch }` endpoints; the choice is invisible above `lib/ai`. The interim
  form manages exactly one provider instance, edited in place
  (`providers[]` length 1) — multi-instance management is M7.1's.
- **Quick-wire assigns all six agents, not just `wizard-assist`.** The
  one-control action writes the narrative profile, one agent profile, and
  assignments for every agent in the registry pointing at that agent
  profile, plus the default provider. This aligns the write with the
  control's own "narrative and agent tasks" label and is forward-safe (no
  surprise `no-profile-assigned` when a later milestone first fires another
  agent). Agent-profile `structuredOutput` defaults to `'auto'`.
- **Per-story override resolves on the default provider.** A bare model id
  in `stories.settings.models[target]` short-circuits the assignment walk
  and resolves as `{ providerId: defaultProviderId, modelId: override }`;
  no default provider yields `provider-missing`. This is the reading most
  consistent with the AC wording and the data-model's "no provider
  component" note. M2-inert (no override UI yet); if the per-turn wiring in
  [Slice 2.7](./07-wiring.md) reveals the intent was "inherit the assigned
  profile's provider," that is a canonical-spec clarification to raise, not
  a silent resolver change.
- **The AgentId registry (`AGENT_IDS` / `AgentId`) lives in `lib/db`, not
  `lib/ai`.** It indexes `app_settings.assignments`, so the config/action
  layer must reach it without importing the AI-SDK barrel — `lib/actions`
  importing `AGENT_IDS` from `lib/ai` dragged the `ai` SDK plus the
  transport modules into `vitest.setup.ts`'s graph and broke `vi.mock` in
  the `lib/ai` tests. `lib/ai` re-exports the registry, so its public
  surface is unchanged. Future slices import `AGENT_IDS` from `lib/db`.
- **`resolveModel` is a pure config-injected function; `getModel` reads the
  store.** The resolver takes `{ providers, profiles, assignments,
defaultProviderId, storyModels }` explicitly (no store read), so 2.9
  pre-flight calls it per agent and 2.7 builds the store adapter at the
  call site. `getModel` does read `appSettingsStore` to resolve a real
  provider instance, with the temporary stub registry as a fallback until
  [Slice 2.7](./07-wiring.md) removes the smoke seam.
- **Configured provider keys are registered into the `httpCallSink`
  redaction comparator at `app_settings` hydrate.** The M1 redaction was
  fed only by the stub registry, so a real OAI-compat call would have
  leaked its raw `Authorization` key into the diagnostics buffer; the
  hydrate path now syncs the comparator from `providers[]` on every
  (re)hydrate, which an integration test covers.
- **`streamProviderCall` ships without bespoke error mapping.**
  `runProviderCall` distinguishes an internal SDK timeout from a user
  cancel; the streaming variant returns the raw `streamText` result (errors
  surface on the stream). [Slice 2.7](./07-wiring.md) wires streaming into
  the store and verifies the SDK v6 timeout-error shape against a real
  endpoint — the one open monitor from this slice.
