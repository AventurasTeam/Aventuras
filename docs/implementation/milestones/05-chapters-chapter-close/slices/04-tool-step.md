# Slice 5.4 — Tool step

## Metadata

- **Milestone:** [Milestone 5 — Chapters + chapter-close](../milestone.md)
- **Depends on:** none; day-one startable
- **Blocks:** [Slice 5.5a](./05a-task-runner.md)

## Goal

`lib/ai` can send one tool step: a conversation and a tool list go out
and one reply comes back, with retries, a per-call bound and a window
check that sees the whole conversation. Both mocks and the stub can
script a step, so the runner can be built and reviewed with no real
model. Nothing in the app sends a step yet; Slice 5.5a is the first
caller.

## Background

A close's tasks use the provider's native tool calling: the model
replies with calls, and code answers them. The loop has to stay in the
phase generator, because a write and its verdict travel by `yield`, so
`lib/ai` offers one step and no loop: tools carry no `execute`, the SDK
stops after one step, and the reply's calls go back to the caller to run
in order. Today `lib/ai` takes only two prompt strings, the window check
counts only text, and a tool request gets `{}` and `stop` from both
mocks, so an E2E close would pass with no writes.

## Required reading

- [`memory/chapter-close.md → The agent`](../../../../memory/chapter-close.md#the-agent),
  mainly [Conversations](../../../../memory/chapter-close.md#conversations),
  [When a task stops](../../../../memory/chapter-close.md#when-a-task-stops)
  and [Tool calling](../../../../memory/chapter-close.md#tool-calling).
- [`memory/chapter-close.md → Failure modes and atomic rollback`](../../../../memory/chapter-close.md#failure-modes-and-atomic-rollback):
  what fails a close and what only stops a task.
- [`architecture.md → System and user halves`](../../../../architecture.md#system-and-user-halves):
  the pair goes first and steps follow it.
- [`architecture.md → The pre-send check`](../../../../architecture.md#the-pre-send-check),
  [Recognizing an overflow rejection](../../../../architecture.md#recognizing-an-overflow-rejection)
  and [Truncation cross-check](../../../../architecture.md#truncation-cross-check).
- [`generation-pipeline.md → Two retry tiers`](../../../../generation-pipeline.md#two-retry-tiers-both-at-phase-level),
  [Cut-off replies](../../../../generation-pipeline.md#cut-off-replies) and
  [Fatal error categories](../../../../generation-pipeline.md#fatal-error-categories).
- [`memory/classifier.md → Failure policy`](../../../../memory/classifier.md#failure-policy):
  the bound a step shares with a pass.
- [`testing.md → Mock LLM`](../../../../testing.md#mock-llm) and
  [`scripts/mock-llm/README.md → Lanes`](../../../../../scripts/mock-llm/README.md#lanes),
  [Failure injection](../../../../../scripts/mock-llm/README.md#failure-injection)
  and [Passthrough and recording](../../../../../scripts/mock-llm/README.md#passthrough-and-recording).
- [`observability.md → Subsystem emission inventory`](../../../../observability.md#subsystem-emission-inventory):
  the `provider` kinds a step logs.
- [Milestone contract C2](../milestone.md#c2--pipeline-shape), its
  closing bullet on the per-call bound.

## Scope: in

**The step.** `generateToolStep` in a new `lib/ai/tool-step.ts`, exported
from `lib/ai/index.ts`, whose comment at `:33-35` names it beside
`streamText` and `generateStructured`. Slice 5.5a writes against this
shape, settled by sequencing:

```ts
function generateToolStep(
  target: ResolveTarget,
  request: ToolStepRequest,
  config: ResolveModelConfig,
  signal: AbortSignal,
  options: StructuredCallOptions, // cacheSystemPrefix, actionId
): Promise<ToolStepResult>

type ToolStepTool = { description: string; inputSchema: z.ZodObject; execute?: never }

type ToolStepRequest = {
  prompt: PromptHalves // the pair, sent first
  messages: readonly ModelMessage[] // what follows it: earlier steps and their answers
  tools: Readonly<Record<string, ToolStepTool>>
  firstCall: boolean // the task's first call: a window failure fails instead of stopping
}

type ToolStep = {
  calls: readonly { toolCallId: string; toolName: string; input: Record<string, unknown> }[]
  invalidCalls: readonly { toolCallId: string; toolName: string; detail: string }[]
  responseMessages: readonly (AssistantModelMessage | ToolModelMessage)[] // as the SDK returned them
  text: string
  finishReason: Exclude<FinishReason, 'length' | 'content-filter'> // a cut or filtered reply is never a step
  usage: LanguageModelUsage
}

type ToolStepResult =
  | { status: 'ok'; step: ToolStep; recoverable: readonly CallRetryError[] }
  | {
      status: 'stopped'
      reason: 'cut-off'
      failure: ReplyCutOffFailure
      recoverable: readonly CallRetryError[]
    }
  | {
      status: 'stopped'
      reason: 'window'
      failure: ContextWindowFailure
      recoverable: readonly CallRetryError[]
    }
  | {
      status: 'failed'
      error: Exclude<CallRetryError, { tier: 'reply-cut-off' }> // a second cut stops instead
      recoverable: readonly CallRetryError[]
    }
  | { status: 'not-configured'; kind: ResolveFailureKind }
  | { status: 'aborted'; recoverable: readonly CallRetryError[] }
```

`stopped`'s `reason` values are [C4](../milestone.md#c4--close_report-v1)'s,
so the caller copies them into `CloseReport.stopped`. Every arm but `not-configured` carries
`recoverable`, so `retriedAttemptEvents` works unchanged.

- **One request.** The pair goes first, a blank system half left out as
  `promptParams` does (`lib/ai/generate.ts`), then
  `request.messages`, then `tools`. No `stopWhen`, so `generateText`
  stops after one step (`ai/src/generate-text/generate-text.ts:261`). No
  streaming. `runProviderCall` keeps `maxRetries: 0`, so retries stay in
  `callWithRetry`.
- **No `execute`.** The type refuses one: the SDK runs a step's `execute`s
  in parallel (`generate-text.ts:1267`), and a phase can't `yield` from
  inside one.
- **The chain.** The cache marker when `cacheSystemPrefix` is set on an
  `anthropic` provider, `carriedCapabilities`, then the window check
  last, as `streamText` orders them (`lib/ai/generate.ts`), with no JSON
  contract. `checkInputTokens` runs on every attempt. `withMiddleware`,
  `windowCheck`, `carriedCapabilities` and `marksSystemPrefix` are
  private to `generate.ts` today: export them inside the module, not from
  `index.ts`.
- **Calls.** `calls` holds the valid calls in the model's order. The SDK
  marks a malformed call or an unknown tool `invalid` and answers it
  itself in the response messages (`generate-text.ts:937-954`), and
  `result.toolCalls` still lists it, so those go in `invalidCalls`. The
  caller answers `calls` only, and a step whose calls were all invalid
  still isn't a finished task.

**Cut-off retry.** `callWithRetry` doesn't change: a `ReplyCutOffError`
from `parseFn` still fails a call at once. The step runs it with
`maxProviderAttempts: 2` and `maxParseAttempts: 1`, and on a
`reply-cut-off` failure runs it once more, under a fresh bound.
Its `parseFn` reads `'length'` and `'content-filter'` before anything
else, so a cut or filtered reply's calls and messages go with it and
never reach the caller. A second cut or filter returns `stopped`,
`reason: 'cut-off'`, with the first one in `recoverable`.
`provider.reply_cut_off` logs each with an `outcome` of `retried` or
`stopped`.

**Output default.** `TOOL_STEP_MAX_OUTPUT_DEFAULT = 8_000` goes out as
`maxOutputTokens` when the profile sets none, a story override's
`params: {}` included (`lib/ai/resolve-model.ts:83`). The same number
reaches `replyCutOff` as `maxOutput`: `generateStructured` passes only the
profile's, and a reasoning spiral would read as `unknown`.

**Call bound (C2).** The step bounds its call with
[Slice 5.2](./02-first-chapter.md)'s `callTimeoutMs` for its target: the
profile's `timeout`, else ten minutes. The bound holds over the whole
call, provider retries included, as a pass's call has
(`lib/pipeline/definitions/periodic-classifier.ts:270`); being the
profile's `timeout`, it bounds each attempt too. A cut-off retry runs
under a fresh bound. An expiry returns `failed` with a provider `timeout` naming the
bound, and a cancel returns `aborted`, so the caller needn't tell them
apart as the pass does at `:287`.

**Window check.**

- `countPromptTokens(prompt, tools)` counts what it counts today, plus
  reasoning text, each tool call's name and input, each tool result's
  name and output, and each tool definition, serialized as JSON. `file`
  parts stay at 0.
- `checked` takes `params.tools` (`windowCheckMiddleware` in
  `lib/ai/context-window.ts`), and
  a `ModelTools` type derives beside `ModelPrompt`
  (`lib/ai/prompt-schema.ts:5-6`).
- **A first call against a later step.** A `context-window` failure,
  checked or provider-detected, returns `failed` under `firstCall: true`
  and `stopped`, `reason: 'window'`, otherwise. Both log
  `provider.context_window`.

**Capability hint, transport half.**

- `tool_choice`, then `tools`, in `CAPABILITY_HINT_KEYWORDS`
  (`lib/ai/transport/classify-provider-error.ts:98-104`), capability
  `toolCalling`, as canon's `CapabilityHint` has it.
- `toolCalling: false` in `CARRIED_NOTHING`, and an arm in
  `carriedCapabilities` reading a non-empty `params.tools`
  (`lib/ai/generate.ts`).
- The union's growth reaches two consumers, and both have to move here:
  `HINT_FIX_TAGS` gets `toolCalling: true`
  (`components/reader/system-entry-actions.tsx:106-109`), and
  `locales/en/reader.json` gets `toolCalling` under `capabilityHint` and
  `memoryCapabilityHint`, worded as their siblings, since
  `capabilityHintContent` builds a typed key from the capability
  (`components/reader/context-window-copy.ts:63-69`). Neither shows yet:
  a turn and a pass send no tools.

**Mocks.**

- **Wire.** `FinishReason` gains `tool_calls` and `content_filter`, and
  a sibling `toolStepBody` writes tool calls and `reasoning_content` in
  the completion envelope `completionBody` shares, which stays as it
  was (`scripts/mock-llm/respond/wire.ts`), from one reply type:

  ```ts
  type MockToolStep = {
    text?: string
    reasoning?: string
    toolCalls?: { name: string; args: unknown }[] // a string `args` goes out verbatim
    finishReason?: FinishReason // default tool_calls with calls, else stop
  }
  ```

  A string `args` lets a spec send a malformed call, and an explicit
  `finishReason` lets it send `stop` beside calls, as some servers do, or
  `length` with whole calls.

- **Routing.** A non-streamed request with a non-empty `tools` is a tool
  lane, keyed `tools:` and the sorted names joined by `+`, ahead of any
  block match. `toolLaneOf(body)` in `scripts/mock-llm/routing.ts` serves
  both mocks. Each task has its own tool list, so its own lane.
- **Usage.** On a tool lane both mocks count the tool definitions,
  `tool_calls` and `reasoning_content` in `prompt_tokens`, which
  `promptText` skips. The app's estimate now counts them, so without this
  a short prompt with six tools reads under the cross-check's 0.5 and
  raises its toast in a spec.
- **E2E harness.** `setToolSteps(tools, steps)` on `e2e/harness/mock-llm.ts`
  queues a lane's replies, answered in order across conversations. A step
  is a `MockToolStep` or a function of the `MockRequest`, since a step can
  name only placeholders its prompt holds. An empty queue answers `{}` and
  `stop`, which finishes a task with no writes, so a spec that scripts
  nothing writes nothing, as `EXAMPLES` promise. `MockRequest.agent` holds
  the lane key, and `holdNextStructured`, `cutNextStructured` and
  `overflowNextStructured` take it, so a tool lane needs no one-shots of
  its own.
- **Dev mock.** `Route` gains a tool arm
  (`scripts/mock-llm/routing.ts`), and a tool lane lists in the
  panel under its own **Tools** group, saved `tools:` lanes included
  across restarts. A canned response's value is a `MockToolStep`, checked
  by `validateLaneValue`, and sequence cycling scripts a conversation.
  `malformed` and `stream-cut` cut the first call's arguments in half, and
  `length` keeps the calls whole with `finish_reason: 'length'`.
  An unconfigured lane answers `{}` and `stop`, as it does now.
- **Record mode.** On a tool lane `passthrough` returns the reply as a
  `MockToolStep`, the log's `served` holds it, and `recordedValue`
  (`scripts/mock-llm/control.ts:38`) saves it, so a real model's calls
  replay (`toolStepOfCompletion` in `scripts/mock-llm/passthrough.ts`).

**Stub.** `tool-step` in `lib/ai/stub/scenarios.ts`: the first reply holds
a `thinking` block with a signature and a `tool_use` block, stopping on
`tool_use`; a request carrying `tool_result`s gets plain text only when
the assistant turn before each of them opens with its thinking block
whole (type, text and signature), else a 400 naming the thinking block.
`tool-step-cut` stops on `max_tokens` and reports the request's
`max_tokens` as its output tokens, so a cut reads as `max-output`. This
is the one route to `@ai-sdk/anthropic`'s tool parsing and signature
replay without a network, and stays unit-only.

**Canon, in the same PR.**

- [`generation-pipeline.md → Two retry tiers`](../../../../generation-pipeline.md#two-retry-tiers-both-at-phase-level):
  the step's exception to "isn't retried", and the causes a cut-off
  failure carries.
- [`generation-pipeline.md → Cut-off replies`](../../../../generation-pipeline.md#cut-off-replies):
  a filter stop on a step takes the cut-off path.
- [`memory/chapter-close.md → When a task stops`](../../../../memory/chapter-close.md#when-a-task-stops):
  the retry's fresh bound, and a filter stop beside a cut.
- [`generation-pipeline.md → Fatal error categories`](../../../../generation-pipeline.md#fatal-error-categories):
  `provider.possibleCapabilityMismatch`: tool calling is carried when a
  non-empty tool list went out.
- [`architecture.md → Recognizing an overflow rejection`](../../../../architecture.md#recognizing-an-overflow-rejection):
  its list of calls the check wraps.
- [`observability.md → Subsystem emission inventory`](../../../../observability.md#subsystem-emission-inventory):
  `reply_cut_off`'s two new outcomes.
- [`testing.md → Mock LLM`](../../../../testing.md#mock-llm) and
  `scripts/mock-llm/README.md`: tool lanes, `setToolSteps`, `MockToolStep`
  and record mode. The canon section says nothing on tools today.

## Scope: out

- The loop: dispatch in order, an answer for every call, reading a
  finish from the calls, the budget, whether a retry counts against the
  24, and `CloseReport.stopped` ([Slice 5.5a](./05a-task-runner.md)).
- Whether a close's steps set `cacheSystemPrefix`
  ([Slice 5.5a](./05a-task-runner.md)).
- Tool definitions, names, schemas and descriptions
  ([Slice 5.5a](./05a-task-runner.md), its fixture, then
  [Slice 5.5b](./05b-identity-threads.md),
  [Slice 5.8](./08-prose-tasks.md) and
  [Slice 5.9](./09-chapter-wide-tasks.md)).
- `pnpm probe:close` ([Slice 5.5a](./05a-task-runner.md)) and the
  measured cost of counting per step ([Slice 5.5b](./05b-identity-threads.md)).
- The hint's `close` surface, its copy and its hint keys
  ([Slice 5.6](./06-close-owed.md)), and the arm that needs the flag
  ([Slice 5.10](./10-two-starts.md)).
- The `toolCalling` flag, its detection and pre-flight
  ([Slice 5.10](./10-two-starts.md)).
- The first E2E through a scripted step ([Slice 5.10](./10-two-starts.md)).
- `closeConversation`, `closeTools` and the `single` driver (M7.1).
- `HTTP_CALLS_CAP` (M7.3).
- `countTokens`'s move to `lib/tokens`
  ([Slice 5.1](./01-token-measure.md)); `lib/ai/context-window.ts:4` keeps
  working through the re-export.

## Acceptance criteria

Unit paths run with `pnpm vitest run --project unit <path>`.

- **One request a step.** `lib/ai/tool-step.test.ts`, over the real
  `openai-compatible` and `anthropic` adapters: one `generateToolStep`
  whose reply holds calls sends exactly one request, carrying the system
  half, the user half, `request.messages` in order, and `tools`. A blank
  system half sends no system message.
- **No `execute`.** A `// @ts-expect-error` in `lib/ai/tool-step.test.ts`
  fails `pnpm typecheck` if `ToolStepTool` accepts one.
- **Calls.** Same file: valid calls come back in the reply's order; a
  malformed call and an unknown tool land in `invalidCalls`, each answered
  in `responseMessages`, and a valid call beside them isn't.
- **Reasoning goes back.** Sending a step's `responseMessages` on the next
  request carries `reasoning_content` on `openai-compatible`
  (`scripts/mock-llm/harness-tool-steps.test.ts`) and the `thinking` block
  with its signature on `anthropic` (stub `tool-step`, in
  `lib/ai/stub/stub-provider.test.ts`).
- **Output default.** `lib/ai/tool-step.test.ts`: no profile max output
  sends `max_tokens: 8000`, a profile's value replaces it, and a `length`
  reply at either reports that `maxOutput` with cause `max-output`.
- **One retry on a cut.** `lib/ai/tool-step.test.ts`: `length` then a
  normal reply is two requests, `ok`, one `reply-cut-off` in `recoverable`;
  `length` twice is two requests and `stopped`, `reason: 'cut-off'`; whole
  calls on a `length` reply appear nowhere in the result. A
  `content-filter` stop takes the same path, with cause `content-filter`.
  `lib/ai/transport/call-with-retry.test.ts`: its existing cut-off tests
  pass unchanged, since `callWithRetry` gains no option.
- **Window count.** The part-type test in `lib/ai/context-window.test.ts`
  flips: reasoning and a `tool-result` count, `file` stays 0.
  `lib/ai/window-check.test.ts`: a prompt under the window whose tool
  definitions take it over is refused unsent.
- **First call against later step.** `lib/ai/tool-step.test.ts`, for
  `detectedBy` `check` and `provider`: `firstCall: true` returns `failed`
  with tier `context-window`, `false` returns `stopped` with reason
  `window`, and neither is retried.
- **Bound.** `lib/ai/tool-step.test.ts`: an expiry returns `failed` with a
  provider `timeout`, an abort of `signal` returns `aborted`, a cut-off
  retry runs under a fresh bound ("gives the retry a whole bound…"), and
  `'lore-mgmt'`'s profile sets the bound. The `passTimeoutMs` tests at
  `lib/pipeline/definitions/periodic-classifier.test.ts:3635` pass
  unchanged.
- **Hint.** `lib/ai/request-shape.test.ts`: a 400 naming `tool_choice` on a
  step sets `possibleCapabilityMismatch` to capability `toolCalling` with
  `tool_choice` matched, one naming `tools` matches `tools`, and the same
  bodies on a narrative and a structured call give no hint.
- **E2E mock.** `scripts/mock-llm/harness-tool-steps.test.ts`, through the
  app's provider to `startMockLlm()`: `setToolSteps` answers in order, a
  function step reads its request, an empty queue answers `{}` and `stop`,
  and the three one-shots work on a tool lane. A short prompt with six
  tools logs no `provider.prompt_truncation_suspected`.
- **Dev mock.** `scripts/mock-llm/transport.test.ts`: a tool lane answers
  a canned step, cycles a sequence, and serves `malformed` and `length`
  through the real adapter. `scripts/mock-llm/routing.test.ts`: the lane
  key doesn't change with tool order, and a tool request matches no shape.
  `scripts/mock-llm/server.test.ts`: a passthrough tool reply saved from
  the log replays with its calls.
- **Stub.** `lib/ai/stub/scenarios.test.ts`: both scenarios answer their
  shape, and the first answers differently once a `tool_result` is in the
  request.
- **Gates.** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
  `pnpm compiler:check`, `pnpm lint:docs` and `pnpm test:run` pass, and
  CI's E2E job stays green, since `wire.ts` reaches the whole suite.

## Tests

- **Vitest over real adapters.** `lib/ai/tool-step.test.ts` extends the
  capturing-fetch pattern of `lib/ai/request-shape.test.ts`, so what's
  asserted is the wire, not a fake's arguments.
- **Vitest against the mock.** `scripts/mock-llm/harness-tool-steps.test.ts`
  follows `harness-cut.test.ts`, with `setTestProviders` so
  `generateToolStep` resolves and sends for real. This is the seam where a
  wire regression would otherwise surface only in 5.10.
- **No Storybook.** No UI lands here.
- **No E2E of its own.** Nothing in the app sends a step until 5.5a, and
  the first scripted E2E is 5.10's Auto close. The existing suite is the
  regression check on `wire.ts`.
- **Prove the branches can fail.** The step's second run on a
  `reply-cut-off` failure, the `firstCall` arm and the output default each
  read fine with the branch removed, so mutate each once before calling
  its test done.

## Open questions

None open: each was answered here or moved to the slice that owns it
(Implementation notes, below).

## Implementation notes

- **A filtered step takes the cut-off path (developer decision at slice
  planning).** A `content-filter` stop, calls or not, is dropped and the
  step runs once more; a second filter or cut returns `stopped`,
  `reason: 'cut-off'`, with the second stop's cause. C4 is unchanged, so
  the review reads it as a cut-off. `chapter-close.md` ends a task only
  on a reply that finishes normally, canon already retries a filtered
  structured call once since a filter may not trip twice, and stopping
  rather than failing keeps a persistent filter (Anthropic's `refusal`)
  from blocking a story's turns. An `'other'` finish with no raw reason
  counts as finished, as on a structured call: the body still arrived
  whole.
- **A cut-off retry runs under a fresh bound (developer decision at
  slice planning).** The cut attempt is the one most likely to have
  spent most of a shared bound, so a second slow loop would fail the
  close where a second cut only stops the task. The step runs
  `callWithRetry` twice and `callWithRetry` doesn't change: the brief's
  `maxCutOffAttempts` would have needed a re-armed bound crossing its
  loop. The step keeps no per-attempt timer, since its run's bound is
  the same profile `timeout`, armed first.
- **A `length` reply's whole calls are dropped and the request sent
  again (developer decision at slice planning):** "never a finished
  task, whatever it holds", and canon won't repair a cut reply into a
  valid but wrong one.
- **Tool steps don't stream (developer decision at slice planning).**
  The loop needs the whole reply, a close has no streaming surface, and
  both mocks route a streamed request to the narrative lane. A stalled
  step shows nothing until its bound expires.
- **The output limit is the profile's `maxOutput`, else 8,000, a story
  override included (developer decision at slice planning).** For a
  step a cap turns a reasoning loop into a task stop, where no cap runs
  it to the server's limit or the bound, and an expiry fails the close.
  Metadata takes the profile's only
  ([Slice 5.2](./02-first-chapter.md#implementation-notes)); boundary
  takes the step's 8k by default, an open question of
  [Slice 5.10](./10-two-starts.md#open-questions)'s.
- **A tool schema with a `.transform` is refused before any request.**
  The plan accepted one; the SDK writes the parsed value into
  `responseMessages` as the call's input, which the next step sends back
  (a string there is a non-object Anthropic `tool_use.input`). The step
  converts both sides, the SDK's input side and `z.toJSONSchema`'s
  output side, and returns `failed`, tier `parse`, attempt 0. No
  schema-level guard sees every form that changes the value (a default,
  a coercion, a `.trim()`, a `.transform().pipe(…)`), so the step keeps
  this one and the rest is
  [Slice 5.5a](./05a-task-runner.md#scope-in)'s tool contract: a schema
  parses to what the model wrote (developer decision, 2026-11-07: "Q2:
  A").
- **The window check counts a tool call's input as its JSON,** a string
  input included, since both adapters serialize it.
- **The E2E harness fails a scripted tool step that throws or can't be
  serialized at once,** with a 400 that names it, so the step fails with
  no retry, then rethrows to the spec. Left to hang, a mistake in a
  [Slice 5.10](./10-two-starts.md) function step would cost a whole
  bound.
- **The answered questions went to their owners.** 5.2's "One helper for
  a bounded structured call?" moved to
  [Slice 5.10](./10-two-starts.md#open-questions), which already holds
  the cut-off boundary reply; the cache marker on a close's steps stays
  [Slice 5.5a](./05a-task-runner.md#open-questions)'s; the cross-check
  on a server that drops past reasoning, and a cut attempt's dropped
  usage, went to [Slice 5.5b](./05b-identity-threads.md#open-questions).
