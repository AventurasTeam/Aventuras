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

type ToolStepTool = { description: string; inputSchema: z.ZodType; execute?: never }

type ToolStepRequest = {
  prompt: PromptHalves // the pair, sent first
  messages: readonly ModelMessage[] // what follows it: earlier steps and their answers
  tools: Readonly<Record<string, ToolStepTool>>
  firstCall: boolean // the task's first call: a window failure fails instead of stopping
}

type ToolStep = {
  calls: readonly { toolCallId: string; toolName: string; input: unknown }[]
  invalidCalls: readonly { toolCallId: string; toolName: string; detail: string }[]
  responseMessages: readonly ModelMessage[] // as the SDK returned them
  text: string
  finishReason: FinishReason
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
  | { status: 'failed'; error: CallRetryError; recoverable: readonly CallRetryError[] }
  | { status: 'not-configured'; kind: ResolveFailureKind }
  | { status: 'aborted'; recoverable: readonly CallRetryError[] }
```

`stopped`'s `reason` values are [C4](../milestone.md#c4--close_report-v1)'s,
so the caller copies them into `CloseReport.stopped`. Every arm but `not-configured` carries
`recoverable`, so `retriedAttemptEvents` works unchanged.

- **One request.** The pair goes first, a blank system half left out as
  `promptParams` does (`lib/ai/generate.ts:199-204`), then
  `request.messages`, then `tools`. No `stopWhen`, so `generateText`
  stops after one step (`ai/src/generate-text/generate-text.ts:261`). No
  streaming. `runProviderCall` keeps `maxRetries: 0`, so retries stay in
  `callWithRetry`.
- **No `execute`.** The type refuses one: the SDK runs a step's `execute`s
  in parallel (`generate-text.ts:1267`), and a phase can't `yield` from
  inside one.
- **The chain.** The cache marker when `cacheSystemPrefix` is set on an
  `anthropic` provider, `carriedCapabilities`, then the window check
  last, as `streamText` orders them (`generate.ts:257-263`), with no JSON
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
reaches `replyCutOff` as `maxOutput`: `generate.ts:488` passes only the
profile's, and a reasoning spiral would read as `unknown`.

**Call bound (C2).** The step bounds its call with
[Slice 5.2](./02-first-chapter.md)'s `callTimeoutMs` for its target: the
profile's `timeout`, else ten minutes. The bound holds over the whole
call, provider retries included, as a pass's call has
(`lib/pipeline/definitions/periodic-classifier.ts:270`), and a profile
`timeout` also bounds each attempt. A cut-off retry runs under a fresh
bound. An expiry returns `failed` with a provider `timeout` naming the
bound, and a cancel returns `aborted`, so the caller needn't tell them
apart as the pass does at `:287`.

**Window check.**

- `countPromptTokens(prompt, tools)` counts what it counts today, plus
  reasoning text, each tool call's name and input, each tool result's
  name and output, and each tool definition, serialized as JSON. `file`
  parts stay at 0.
- `checked` takes `params.tools` (`lib/ai/context-window.ts:153-154`), and
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
  (`generate.ts:172-190`).
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
  (`scripts/mock-llm/routing.ts:145-158`), and a tool lane lists in the
  panel under its own **Tools** group, saved `tools:` lanes included
  across restarts. A canned response's value is a `MockToolStep`, checked
  by `validateLaneValue`, and sequence cycling scripts a conversation.
  `malformed` and `stream-cut` cut the first call's arguments in half, and
  `length` keeps the calls whole with `finish_reason: 'length'`.
  An unconfigured lane answers `{}` and `stop`, as it does now.
- **Record mode.** On a tool lane `passthrough` returns the reply as a
  `MockToolStep`, the log's `served` holds it, and `recordedValue`
  (`scripts/mock-llm/control.ts:38`) saves it, so a real model's calls
  replay (`scripts/mock-llm/passthrough.ts:38-45`).

**Stub.** `tool-step` in `lib/ai/stub/scenarios.ts`: the first reply holds
a `thinking` block with a signature and a `tool_use` block, stopping on
`tool_use`; a request carrying a `tool_result` gets plain text only when
the assistant turn before it opens with that thinking block whole (type,
text and signature), else a 400 naming the thinking block.
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
- **Window count.** The test at `lib/ai/context-window.test.ts:203-232`
  flips: reasoning and a `tool-result` count, `file` stays 0.
  `lib/ai/window-check.test.ts`: a prompt under the window whose tool
  definitions take it over is refused unsent.
- **First call against later step.** `lib/ai/tool-step.test.ts`, for
  `detectedBy` `check` and `provider`: `firstCall: true` returns `failed`
  with tier `context-window`, `false` returns `stopped` with reason
  `window`, and neither is retried.
- **Bound.** `lib/ai/tool-step.test.ts`: an expiry returns `failed` with a
  provider `timeout`, an abort of `signal` returns `aborted`, and
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

- **A step with no call that stops on `content-filter` or `other`.**
  Canon's general rule reads both as finished, so a filtered step ends its
  task with no sign of it, while a structured call retries a filter once.
  Does a step retry it? `finishReason` reaches the caller either way, and
  the answer is one branch in the step's `parseFn`.
- **A `length` reply holding whole calls.** This slice reads "never a
  finished task, whatever it holds" and "retried once" as dropping them
  and sending the same prompt again. Confirm that reading: the other one
  runs whole calls from a reply the server stopped.
- **Do tool steps stream?** Canon doesn't say. They don't here: the loop
  needs the whole reply, a close has no streaming surface, and a streamed
  request lands on both mocks' narrative path. The cost is that a stalled
  step shows nothing until its bound expires.
- **Max output for boundary and metadata.** The 8k default is stated for a
  step, and a story override sends these calls no limit. Do they take it
  too? `generateStructured` doesn't change here; the answer lands in
  [Slice 5.2](./02-first-chapter.md) for metadata and
  [Slice 5.10](./10-two-starts.md) for boundary.
- **A cut-off boundary reply.** Is it unusable, so it takes the fallback,
  or a failed call? Canon names only a provider failure as failed. The
  answer lands in [Slice 5.10](./10-two-starts.md).
- **The bound across a cut-off retry.** Bounded "as a pass's is", the
  retry shares the first attempt's time, so an expiry on it fails the
  close where the same reply cut again would only stop the task. Does the
  retry get a fresh bound? This slice keeps the pass's rule.
- **Does a close's step carry the cache marker?** The step takes
  `cacheSystemPrefix`, so neither answer changes it. Anthropic's
  prompt-caching docs put the prefix in the order tools, system, messages,
  and a change to tool definitions invalidates all of it (read 2026-11-01,
  not tested by a request). So under `closeTools: separate` the chapter's
  cache holds across a task's own steps and not across tasks, and a marker
  writes it again for each tool list. [Slice 5.5a](./05a-task-runner.md)
  decides.
- **The cross-check on a server that drops past reasoning.** The estimate
  counts reasoning sent back. A chat template that renders only the latest
  reasoning reports fewer input tokens, so a long conversation could read
  under 0.5, raise the truncation toast, and stop early on a window it
  hasn't filled. Unverified on any server; `provider.input_ratio` in
  [Slice 5.5b](./05b-identity-threads.md)'s run shows it.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
