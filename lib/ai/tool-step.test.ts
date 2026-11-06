import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { ModelMessage } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { z } from 'zod'

import { logger, type Logger } from '@/lib/diagnostics'

import type { ModelProfile } from '../db'
import type { PromptHalves } from './generate'
import { getModel } from './model'
import type { ResolveModelConfig } from './resolve-model'
import {
  generateToolStep,
  TOOL_STEP_MAX_OUTPUT_DEFAULT,
  type ToolStep,
  type ToolStepRequest,
  type ToolStepResult,
  type ToolStepTool,
} from './tool-step'
import { __resetTruncationCheck } from './truncation-check'

// The real adapters over a capturing fetch, as request-shape.test.ts does; the real resolver, so a
// profile's maxOutput and timeout reach the step the way a configured lore-mgmt profile's would.
vi.mock('./model', () => ({ getModel: vi.fn() }))

type ProviderType = 'anthropic' | 'openai-compatible'
type Body = Record<string, unknown> & { messages: Record<string, unknown>[] }
type Answer = (signal: AbortSignal | undefined) => Response | Promise<Response>

let bodies: Body[] = []
// One answer per request a test expects; a request with none queued fails like a dead server.
let answers: Answer[] = []

const capture: typeof fetch = async (_input, init) => {
  bodies.push(JSON.parse(String(init?.body)) as Body)
  const answer = answers.shift()
  if (answer === undefined) throw new Error('no answer queued for this request')
  return answer(init?.signal ?? undefined)
}

const MODELS = {
  anthropic: () => createAnthropic({ apiKey: 'test-key', fetch: capture })('claude-sonnet-4-5'),
  'openai-compatible': () =>
    createOpenAICompatible({
      name: 'local',
      baseURL: 'http://127.0.0.1:9/v1',
      apiKey: 'test-key',
      fetch: capture,
    })('local-model'),
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

type WireCall = { id: string; name: string; arguments: string }

function openaiReply(
  opts: {
    content?: string
    reasoning?: string
    calls?: WireCall[]
    finish?: string
    usage?: { prompt_tokens: number; completion_tokens: number }
  } = {},
): Answer {
  return () =>
    json({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 0,
      model: 'local-model',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: opts.content ?? '',
            ...(opts.reasoning !== undefined ? { reasoning_content: opts.reasoning } : {}),
            ...(opts.calls !== undefined
              ? {
                  tool_calls: opts.calls.map((call) => ({
                    id: call.id,
                    type: 'function',
                    function: { name: call.name, arguments: call.arguments },
                  })),
                }
              : {}),
          },
          finish_reason: opts.finish ?? (opts.calls !== undefined ? 'tool_calls' : 'stop'),
        },
      ],
      ...(opts.usage !== undefined
        ? {
            usage: {
              ...opts.usage,
              total_tokens: opts.usage.prompt_tokens + opts.usage.completion_tokens,
            },
          }
        : {}),
    })
}

function anthropicReply(content: unknown[], stopReason: string): Answer {
  return () =>
    json({
      type: 'message',
      id: 'msg_test',
      role: 'assistant',
      model: 'claude-sonnet-4-5',
      content,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    })
}

// retry-after 0: a retrying call retries at once, so a missed short-circuit shows as a second body.
function rejection(status: number, body: unknown): Answer {
  return () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'retry-after': '0' },
    })
}

// Answers only when aborted, as a stalled server does.
const hang: Answer = (signal) =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
      once: true,
    })
  })

const LORE_PROFILE: ModelProfile = {
  id: 'prof-lore',
  kind: 'agent',
  name: 'Lore',
  modelRef: { providerId: 'prov', modelId: 'm' },
}

function useProvider(
  type: ProviderType,
  opts: { profile?: Partial<ModelProfile>; window?: number; override?: boolean } = {},
): ResolveModelConfig {
  vi.mocked(getModel).mockReturnValue(MODELS[type]())
  return {
    providers: [
      {
        id: 'prov',
        type,
        displayName: 'P',
        apiKey: 'test-key',
        favoriteModelIds: [],
        ...(opts.window !== undefined ? { contextWindowOverrides: { m: opts.window } } : {}),
      },
    ],
    // The classifier's profile has a timeout of its own, which the step must not read.
    profiles: [
      { ...LORE_PROFILE, ...opts.profile },
      { ...LORE_PROFILE, id: 'prof-cls', name: 'Classifier', timeout: 5 },
    ],
    assignments: { 'lore-mgmt': 'prof-lore', classifier: 'prof-cls' },
    ...(opts.override === true
      ? { storyModels: { 'lore-mgmt': { providerId: 'prov', modelId: 'm' } } }
      : {}),
  }
}

const HALVES: PromptHalves = {
  system: '# Chapter\nThe drowned city, chapter two.',
  user: '# Task\nRecord who learned what.',
}
const TOOLS: Record<string, ToolStepTool> = {
  lookup: { description: 'Find a row by name.', inputSchema: z.object({ query: z.string() }) },
  finish: { description: 'End the task.', inputSchema: z.object({}) },
}
// A step already answered: the call and the result the caller sent back.
const EARLIER: ModelMessage[] = [
  {
    role: 'assistant',
    content: [
      { type: 'tool-call', toolCallId: 'call_0', toolName: 'lookup', input: { query: 'bell' } },
    ],
  },
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'call_0',
        toolName: 'lookup',
        output: { type: 'text', value: 'ent_bell: the tower bell' },
      },
    ],
  },
]

function step(
  config: ResolveModelConfig,
  over: Partial<ToolStepRequest> = {},
  opts: { signal?: AbortSignal; actionId?: string; cacheSystemPrefix?: boolean } = {},
): Promise<ToolStepResult> {
  return generateToolStep(
    'lore-mgmt',
    { prompt: HALVES, messages: EARLIER, tools: TOOLS, firstCall: true, ...over },
    config,
    opts.signal ?? new AbortController().signal,
    {
      actionId: opts.actionId ?? null,
      ...(opts.cacheSystemPrefix !== undefined
        ? { cacheSystemPrefix: opts.cacheSystemPrefix }
        : {}),
    },
  )
}

function okStep(result: ToolStepResult): ToolStep {
  if (result.status !== 'ok') throw new Error(`expected an ok step, got ${JSON.stringify(result)}`)
  return result.step
}

let warn: MockInstance<Logger['warn']>

beforeEach(() => {
  bodies = []
  answers = []
  __resetTruncationCheck()
  warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warn.mockRestore()
  vi.useRealTimers()
})

const warnings = (kind: string) => warn.mock.calls.filter(([logged]) => logged === kind)

const LOOKUP_DOOR: WireCall = { id: 'call_1', name: 'lookup', arguments: '{"query":"the door"}' }

// architecture.md → System and user halves: the pair first, the steps after it.
describe('generateToolStep: one request', () => {
  it('sends openai-compatible the pair, the conversation and the tools, once', async () => {
    answers = [openaiReply({ calls: [LOOKUP_DOOR] })]

    okStep(await step(useProvider('openai-compatible')))

    expect(bodies).toHaveLength(1)
    expect(bodies[0]!.messages).toEqual([
      { role: 'system', content: HALVES.system },
      { role: 'user', content: HALVES.user },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_0',
            type: 'function',
            function: { name: 'lookup', arguments: '{"query":"bell"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_0', content: 'ent_bell: the tower bell' },
    ])
    const wireTools = bodies[0]!.tools as { function: { name: string; parameters: unknown } }[]
    expect(wireTools.map((t) => t.function.name)).toEqual(['lookup', 'finish'])
    expect(wireTools[0]).toEqual({
      type: 'function',
      function: {
        name: 'lookup',
        description: 'Find a row by name.',
        parameters: wireTools[0]!.function.parameters,
      },
    })
  })

  // With every call invalid the SDK answers them all itself, so only its one-step default stops it.
  it('sends once when every call in the reply is invalid', async () => {
    answers = [
      openaiReply({
        calls: [
          { id: 'call_1', name: 'lookup', arguments: '{"query": "the do' },
          { id: 'call_2', name: 'teleport', arguments: '{}' },
        ],
      }),
      openaiReply({ content: 'Done.' }),
    ]

    const result = okStep(await step(useProvider('openai-compatible')))

    expect(bodies).toHaveLength(1)
    expect(result.calls).toEqual([])
    expect(result.invalidCalls.map((call) => call.toolCallId)).toEqual(['call_1', 'call_2'])
  })

  it('sends anthropic the system half, then the user half and the conversation, and the tools', async () => {
    answers = [
      anthropicReply(
        [{ type: 'tool_use', id: 'toolu_1', name: 'lookup', input: { query: 'the door' } }],
        'tool_use',
      ),
    ]

    okStep(await step(useProvider('anthropic')))

    expect(bodies).toHaveLength(1)
    expect(bodies[0]!.system).toEqual([{ type: 'text', text: HALVES.system }])
    expect(bodies[0]!.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: HALVES.user }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'call_0', name: 'lookup', input: { query: 'bell' } }],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_0', content: 'ent_bell: the tower bell' },
        ],
      },
    ])
    expect((bodies[0]!.tools as { name: string }[]).map((t) => t.name)).toEqual([
      'lookup',
      'finish',
    ])
  })

  it.each(['anthropic', 'openai-compatible'] as const)(
    'sends %s no system message for a blank system half',
    async (type) => {
      answers = [
        type === 'anthropic'
          ? anthropicReply([{ type: 'text', text: 'Done.' }], 'end_turn')
          : openaiReply({ content: 'Done.' }),
      ]

      okStep(await step(useProvider(type), { prompt: { system: '  ', user: HALVES.user } }))

      expect(bodies[0]).not.toHaveProperty('system')
      expect(bodies[0]!.messages.map((m) => m.role)).not.toContain('system')
    },
  )

  it('takes no tool that carries an execute', () => {
    const runsItself: ToolStepTool = {
      description: 'Runs itself.',
      inputSchema: z.object({}),
      // @ts-expect-error the caller runs each call; the SDK would run an execute in parallel
      execute: async () => 'done',
    }
    expect(runsItself.description).toBe('Runs itself.')
  })
})

// memory/chapter-close.md → Conversations: the reply's calls go back unrun, in the model's order.
describe('generateToolStep: the calls', () => {
  it('returns valid calls in the order the reply gave them', async () => {
    answers = [
      openaiReply({
        reasoning: 'Look first, then finish.',
        calls: [
          LOOKUP_DOOR,
          { id: 'call_2', name: 'finish', arguments: '{}' },
          { id: 'call_3', name: 'lookup', arguments: '{"query":"the bell"}' },
        ],
      }),
    ]

    const result = okStep(await step(useProvider('openai-compatible')))

    expect(result.calls).toEqual([
      { toolCallId: 'call_1', toolName: 'lookup', input: { query: 'the door' } },
      { toolCallId: 'call_2', toolName: 'finish', input: {} },
      { toolCallId: 'call_3', toolName: 'lookup', input: { query: 'the bell' } },
    ])
    expect(result.invalidCalls).toEqual([])
    expect(result.finishReason).toBe('tool-calls')
    // Reasoning stays in the response messages, so the next step sends it back.
    expect(result.responseMessages[0]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'reasoning', text: 'Look first, then finish.' }, {}, {}, {}],
    })
  })

  it('returns anthropic tool_use blocks as calls in their order', async () => {
    answers = [
      anthropicReply(
        [
          { type: 'text', text: 'Checking two rows.' },
          { type: 'tool_use', id: 'toolu_1', name: 'lookup', input: { query: 'the door' } },
          { type: 'tool_use', id: 'toolu_2', name: 'finish', input: {} },
        ],
        'tool_use',
      ),
    ]

    const result = okStep(await step(useProvider('anthropic')))

    expect(result.calls).toEqual([
      { toolCallId: 'toolu_1', toolName: 'lookup', input: { query: 'the door' } },
      { toolCallId: 'toolu_2', toolName: 'finish', input: {} },
    ])
    expect(result.text).toBe('Checking two rows.')
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
  })

  // The SDK marks both invalid and answers each itself (ai generate-text.ts, the tool-error parts).
  it('puts a malformed call and an unknown tool in invalidCalls, each answered, the valid one not', async () => {
    answers = [
      openaiReply({
        calls: [
          LOOKUP_DOOR,
          { id: 'call_2', name: 'lookup', arguments: '{"query": "the do' },
          { id: 'call_3', name: 'teleport', arguments: '{}' },
        ],
      }),
    ]

    const result = okStep(await step(useProvider('openai-compatible')))

    expect(result.calls).toEqual([
      { toolCallId: 'call_1', toolName: 'lookup', input: { query: 'the door' } },
    ])
    expect(result.invalidCalls).toEqual([
      {
        toolCallId: 'call_2',
        toolName: 'lookup',
        detail: expect.stringMatching(/^Invalid input for tool lookup: JSON parsing failed/),
      },
      {
        toolCallId: 'call_3',
        toolName: 'teleport',
        detail: expect.stringMatching(/^Model tried to call unavailable tool 'teleport'/),
      },
    ])
    const answered = result.responseMessages.flatMap((message) =>
      message.role === 'tool'
        ? message.content.flatMap((part) => (part.type === 'tool-result' ? [part.toolCallId] : []))
        : [],
    )
    expect(answered).toEqual(['call_2', 'call_3'])
  })

  it('reads an anthropic call whose input breaks the schema as invalid', async () => {
    answers = [
      anthropicReply(
        [
          { type: 'tool_use', id: 'toolu_1', name: 'lookup', input: { name: 'the door' } },
          { type: 'tool_use', id: 'toolu_2', name: 'finish', input: {} },
        ],
        'tool_use',
      ),
    ]

    const result = okStep(await step(useProvider('anthropic')))

    expect(result.calls).toEqual([{ toolCallId: 'toolu_2', toolName: 'finish', input: {} }])
    expect(result.invalidCalls).toEqual([
      {
        toolCallId: 'toolu_1',
        toolName: 'lookup',
        detail: expect.stringMatching(/^Invalid input for tool lookup: Type validation failed/),
      },
    ])
  })
})

// memory/chapter-close.md → When a task stops: the profile's max output, else 8k.
describe('generateToolStep: the output limit', () => {
  it('is 8000 tokens', () => {
    expect(TOOL_STEP_MAX_OUTPUT_DEFAULT).toBe(8000)
  })

  it.each([
    ['no profile max output', {}, 8000],
    ["the profile's max output", { profile: { maxOutput: 2048 } }, 2048],
    ['a story override', { override: true, profile: { maxOutput: 2048 } }, 8000],
  ] as const)('sends max_tokens for %s', async (_label, opts, sent) => {
    answers = [openaiReply({ content: 'Done.' })]

    okStep(await step(useProvider('openai-compatible', opts)))

    expect(bodies[0]!.max_tokens).toBe(sent)
  })
})

// classifier.md → Failure policy: the step holds the agent's bound, retries included.
describe('generateToolStep: the bound', () => {
  it("fails as a provider timeout when lore-mgmt's profile timeout expires", async () => {
    vi.useFakeTimers()
    answers = [hang]

    const pending = step(useProvider('openai-compatible', { profile: { timeout: 45 } }))
    await vi.advanceTimersByTimeAsync(44_999)
    expect(bodies).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)

    expect(await pending).toEqual({
      status: 'failed',
      error: { tier: 'provider', reason: 'timeout', detail: 'lore-mgmt: timeout after 45000ms' },
      recoverable: [],
    })
  })

  it('shares the bound between a provider retry and the attempt before it', async () => {
    vi.useFakeTimers()
    answers = [rejection(500, { error: { message: 'upstream exploded' } }), hang]

    const pending = step(useProvider('openai-compatible', { profile: { timeout: 45 } }))
    await vi.advanceTimersByTimeAsync(45_000)

    expect(await pending).toMatchObject({
      status: 'failed',
      error: { tier: 'provider', reason: 'timeout', detail: 'lore-mgmt: timeout after 45000ms' },
      recoverable: [{ tier: 'provider', reason: 'network' }],
    })
    expect(bodies).toHaveLength(2)
  })

  it('is ten minutes under a story override, which sets no timeout', async () => {
    vi.useFakeTimers()
    answers = [hang]

    const pending = step(useProvider('openai-compatible', { override: true }))
    await vi.advanceTimersByTimeAsync(600_000)

    expect(await pending).toMatchObject({
      status: 'failed',
      error: { detail: 'lore-mgmt: timeout after 600000ms' },
    })
  })

  it('returns aborted when the caller cancels', async () => {
    const controller = new AbortController()
    answers = [hang]

    const pending = step(useProvider('openai-compatible'), {}, { signal: controller.signal })
    await vi.waitFor(() => expect(bodies).toHaveLength(1))
    controller.abort()

    expect(await pending).toEqual({ status: 'aborted', recoverable: [] })
  })
})

describe('generateToolStep: before the request', () => {
  it('returns not-configured when lore-mgmt has no profile', async () => {
    const config = { ...useProvider('openai-compatible'), assignments: {} }

    expect(await step(config)).toEqual({ status: 'not-configured', kind: 'no-profile-assigned' })
    expect(bodies).toEqual([])
  })

  it('fails, sending nothing, on a tool schema with no JSON Schema form', async () => {
    const result = await step(useProvider('openai-compatible'), {
      tools: {
        ...TOOLS,
        schedule: { description: 'Set a date.', inputSchema: z.object({ when: z.date() }) },
      },
    })

    expect(result).toEqual({
      status: 'failed',
      error: { tier: 'parse', detail: expect.stringMatching(/^tool schedule: /), attempt: 0 },
      recoverable: [],
    })
    expect(bodies).toEqual([])
  })

  // A pipe's output side converts here, so only the SDK's input-side conversion refuses it.
  it('fails, sending nothing, on a tool schema whose input side has no JSON Schema form', async () => {
    const result = await step(useProvider('openai-compatible'), {
      tools: {
        ...TOOLS,
        lookup: {
          description: 'Find a row by name.',
          inputSchema: z.object({ query: z.custom<string>(() => true).pipe(z.string()) }),
        },
      },
    })

    expect(result).toEqual({
      status: 'failed',
      error: { tier: 'parse', detail: expect.stringMatching(/^tool lookup: /), attempt: 0 },
      recoverable: [],
    })
    expect(bodies).toEqual([])
  })

  // The SDK returns a transform's output as the call's input, which the next step sends back.
  it.each([
    ['a schema', z.object({ query: z.string() }).transform(({ query }) => query.trim())],
    ['a field', z.object({ query: z.string().transform((query) => query.trim()) })],
  ] as const)('fails, sending nothing, on a transform on %s', async (_label, inputSchema) => {
    const result = await step(useProvider('openai-compatible'), {
      tools: { ...TOOLS, lookup: { description: 'Find a row by name.', inputSchema } },
    })

    expect(result).toEqual({
      status: 'failed',
      error: {
        tier: 'parse',
        detail: expect.stringMatching(/^tool lookup: .*Transforms/),
        attempt: 0,
      },
      recoverable: [],
    })
    expect(bodies).toEqual([])
  })

  it('sends a tool whose schema has a default and a preprocess', async () => {
    answers = [openaiReply({ calls: [LOOKUP_DOOR] })]

    const result = okStep(
      await step(useProvider('openai-compatible'), {
        tools: {
          lookup: {
            description: 'Find a row by name.',
            inputSchema: z.object({
              query: z.preprocess((value) => String(value).trim(), z.string()),
              limit: z.number().default(5),
            }),
          },
        },
      }),
    )

    expect(bodies).toHaveLength(1)
    expect(result.calls).toEqual([
      { toolCallId: 'call_1', toolName: 'lookup', input: { query: 'the door', limit: 5 } },
    ])
  })
})

// architecture.md → System and user halves: the step carries the chain a structured call does.
describe('generateToolStep: the chain', () => {
  it('marks the anthropic system block when asked, and only then', async () => {
    const done = anthropicReply([{ type: 'text', text: 'Done.' }], 'end_turn')
    answers = [done, done]

    okStep(await step(useProvider('anthropic'), {}, { cacheSystemPrefix: true }))
    okStep(await step(useProvider('anthropic'), {}, { cacheSystemPrefix: false }))

    expect(bodies[0]!.system).toEqual([
      { type: 'text', text: HALVES.system, cache_control: { type: 'ephemeral' } },
    ])
    expect(JSON.stringify(bodies[1])).not.toContain('cache_control')
  })

  // architecture.md → Truncation cross-check: a reported input under half the estimate.
  it('checks the reported input of the reply against the estimate', async () => {
    answers = [openaiReply({ content: 'Done.', usage: { prompt_tokens: 1, completion_tokens: 2 } })]

    okStep(await step(useProvider('openai-compatible'), {}, { actionId: 'act_1' }))

    expect(vi.mocked(getModel).mock.lastCall).toEqual(['prov', 'm', 'act_1'])
    expect(warnings('provider.prompt_truncation_suspected')).toEqual([
      [
        'provider.prompt_truncation_suspected',
        expect.objectContaining({ providerId: 'prov', modelId: 'm', reported: 1 }),
        { actionId: 'act_1' },
      ],
    ])
  })
})

const after =
  (ms: number, answer: Answer): Answer =>
  (signal) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(answer(signal)), ms)
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          reject(new DOMException('aborted', 'AbortError'))
        },
        { once: true },
      )
    })

// Whole calls the server stopped at its limit: never run, never returned.
const CUT_CALLS: WireCall[] = [{ id: 'call_cut', name: 'lookup', arguments: '{"query":"the cut"}' }]
const AT_DEFAULT = { prompt_tokens: 120, completion_tokens: 8000 }
const cutReply = (usage = AT_DEFAULT) => openaiReply({ calls: CUT_CALLS, finish: 'length', usage })
const DONE = openaiReply({ content: 'Done.' })

const CUT_AT_DEFAULT = {
  cause: 'max-output',
  outputTokens: 8000,
  reasoningTokens: 0,
  maxOutput: 8000,
  window: null,
  providerId: 'prov',
  modelId: 'm',
} as const

const cutLogs = () => warnings('provider.reply_cut_off')

// generation-pipeline.md → Cut-off replies: a step's cut is retried once, then stops its task.
describe('generateToolStep: a reply cut off', () => {
  it('retries a cut once, and returns the next reply with the cut in recoverable', async () => {
    answers = [cutReply(), DONE]

    const result = await step(useProvider('openai-compatible'))

    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toEqual(bodies[0])
    expect(result).toMatchObject({
      status: 'ok',
      step: { text: 'Done.', calls: [] },
      recoverable: [{ tier: 'reply-cut-off', ...CUT_AT_DEFAULT }],
    })
    expect(JSON.stringify(result)).not.toContain('call_cut')
  })

  it('stops the task on a second cut, returning neither reply', async () => {
    answers = [cutReply(), cutReply()]

    const result = await step(useProvider('openai-compatible'))

    expect(bodies).toHaveLength(2)
    expect(result).toEqual({
      status: 'stopped',
      reason: 'cut-off',
      failure: CUT_AT_DEFAULT,
      recoverable: [{ tier: 'reply-cut-off', ...CUT_AT_DEFAULT }],
    })
    expect(JSON.stringify(result)).not.toContain('call_cut')
  })

  it("reports the profile's max output on a cut at it", async () => {
    answers = [
      cutReply({ prompt_tokens: 120, completion_tokens: 2048 }),
      cutReply({ prompt_tokens: 120, completion_tokens: 2048 }),
    ]

    const result = await step(useProvider('openai-compatible', { profile: { maxOutput: 2048 } }))

    expect(result).toMatchObject({
      status: 'stopped',
      reason: 'cut-off',
      failure: { cause: 'max-output', outputTokens: 2048, maxOutput: 2048 },
    })
  })

  it('logs the retried cut, then the stopping one, with the target and the numbers', async () => {
    answers = [cutReply(), cutReply()]

    await step(useProvider('openai-compatible'), {}, { actionId: 'act_1' })

    expect(cutLogs()).toEqual([
      [
        'provider.reply_cut_off',
        { outcome: 'retried', target: 'lore-mgmt', ...CUT_AT_DEFAULT },
        { actionId: 'act_1' },
      ],
      [
        'provider.reply_cut_off',
        { outcome: 'stopped', target: 'lore-mgmt', ...CUT_AT_DEFAULT },
        { actionId: 'act_1' },
      ],
    ])
  })

  it('logs one retried cut when the retry finishes', async () => {
    answers = [cutReply(), DONE]

    await step(useProvider('openai-compatible'))

    expect(cutLogs()).toEqual([
      [
        'provider.reply_cut_off',
        { outcome: 'retried', target: 'lore-mgmt', ...CUT_AT_DEFAULT },
        undefined,
      ],
    ])
  })
})

// A filter's stop takes the cut-off path: a filter may not trip twice, and one that does stops the
// task instead of failing the close.
describe('generateToolStep: a reply a filter stopped', () => {
  const FILTERED = { cause: 'content-filter', providerId: 'prov', modelId: 'm' } as const

  it.each([
    ['openai-compatible', () => openaiReply({ calls: CUT_CALLS, finish: 'content_filter' })],
    [
      'anthropic',
      () =>
        anthropicReply(
          [{ type: 'tool_use', id: 'call_cut', name: 'lookup', input: { query: 'the cut' } }],
          'refusal',
        ),
    ],
  ] as const)('retries a %s filter once, then stops', async (type, filtered) => {
    answers = [filtered(), filtered()]

    const result = await step(useProvider(type))

    expect(bodies).toHaveLength(2)
    expect(result).toMatchObject({
      status: 'stopped',
      reason: 'cut-off',
      failure: FILTERED,
      recoverable: [{ tier: 'reply-cut-off', ...FILTERED }],
    })
    expect(JSON.stringify(result)).not.toContain('call_cut')
    expect(cutLogs().map(([, fields]) => fields)).toEqual([
      expect.objectContaining({ outcome: 'retried', cause: 'content-filter' }),
      expect.objectContaining({ outcome: 'stopped', cause: 'content-filter' }),
    ])
  })

  it('returns the retry when the filter does not trip again', async () => {
    answers = [openaiReply({ content: 'No.', finish: 'content_filter' }), DONE]

    expect(await step(useProvider('openai-compatible'))).toMatchObject({
      status: 'ok',
      step: { text: 'Done.' },
      recoverable: [{ tier: 'reply-cut-off', cause: 'content-filter' }],
    })
  })

  // generation-pipeline.md → Cut-off replies: a non-streamed body that omits it arrives whole.
  it("reads an 'other' finish with no raw reason as a step", async () => {
    answers = [
      () =>
        json({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          created: 0,
          model: 'local-model',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Done.' } }],
        }),
    ]

    const result = okStep(await step(useProvider('openai-compatible')))

    expect(result.finishReason).toBe('other')
    expect(bodies).toHaveLength(1)
  })
})

// memory/chapter-close.md → When a task stops: the retry gets a bound of its own.
describe('generateToolStep: the bound across a cut-off retry', () => {
  it('gives the retry a whole bound after a cut that took most of the first', async () => {
    vi.useFakeTimers()
    answers = [after(25_000, cutReply()), after(25_000, cutReply())]

    const pending = step(useProvider('openai-compatible', { profile: { timeout: 30 } }))
    await vi.advanceTimersByTimeAsync(50_000)

    expect(await pending).toMatchObject({ status: 'stopped', reason: 'cut-off' })
    expect(bodies).toHaveLength(2)
  })

  it('fails as a timeout when the retry outlasts its own bound, keeping the first cut', async () => {
    vi.useFakeTimers()
    answers = [after(25_000, cutReply()), hang]

    const pending = step(useProvider('openai-compatible', { profile: { timeout: 30 } }))
    await vi.advanceTimersByTimeAsync(55_000)

    expect(await pending).toEqual({
      status: 'failed',
      error: { tier: 'provider', reason: 'timeout', detail: 'lore-mgmt: timeout after 30000ms' },
      recoverable: [{ tier: 'reply-cut-off', ...CUT_AT_DEFAULT }],
    })
  })

  it('returns aborted, keeping the first cut, when the caller cancels the retry', async () => {
    const controller = new AbortController()
    answers = [cutReply(), hang]

    const pending = step(useProvider('openai-compatible'), {}, { signal: controller.signal })
    await vi.waitFor(() => expect(bodies).toHaveLength(2))
    controller.abort()

    expect(await pending).toEqual({
      status: 'aborted',
      recoverable: [{ tier: 'reply-cut-off', ...CUT_AT_DEFAULT }],
    })
  })
})

const LLAMA_MESSAGE =
  'request (71834 tokens) exceeds the available context size (65536 tokens), try increasing it'
const LLAMA_OVERFLOW = {
  error: { code: 400, message: LLAMA_MESSAGE, type: 'exceed_context_size_error' },
}

// architecture.md → The pre-send check: a task's first call failing fails the close; a later step
// outgrowing the window only stops its task.
describe('generateToolStep: the window', () => {
  const windowLogs = () => warnings('provider.context_window')

  it.each([
    [true, 'failed'],
    [false, 'stopped'],
  ] as const)(
    'refuses unsent a call over a known window; firstCall %s is %s',
    async (firstCall, _status) => {
      const result = await step(useProvider('openai-compatible', { window: 10 }), { firstCall })

      const failure = {
        detectedBy: 'check',
        estimate: expect.any(Number),
        window: 10,
        windowSource: 'configured',
        providerId: 'prov',
        modelId: 'm',
      }
      expect(result).toEqual(
        firstCall
          ? { status: 'failed', error: { tier: 'context-window', ...failure }, recoverable: [] }
          : { status: 'stopped', reason: 'window', failure, recoverable: [] },
      )
      expect(bodies).toEqual([])
    },
  )

  it.each([
    [true, 'failed'],
    [false, 'stopped'],
  ] as const)(
    'reads a provider overflow after one request; firstCall %s is %s',
    async (firstCall, _status) => {
      answers = [rejection(400, LLAMA_OVERFLOW), rejection(400, LLAMA_OVERFLOW)]

      const result = await step(useProvider('openai-compatible'), { firstCall })

      const failure = {
        detectedBy: 'provider',
        estimate: expect.any(Number),
        window: null,
        windowSource: 'unknown',
        providerId: 'prov',
        modelId: 'm',
        detail: LLAMA_MESSAGE,
      }
      expect(result).toEqual(
        firstCall
          ? { status: 'failed', error: { tier: 'context-window', ...failure }, recoverable: [] }
          : { status: 'stopped', reason: 'window', failure, recoverable: [] },
      )
      expect(bodies).toHaveLength(1)
    },
  )

  it.each([
    ['check', { window: 10 }, []],
    ['provider', {}, [rejection(400, LLAMA_OVERFLOW)]],
  ] as const)(
    'logs a %s window failure once, with no cut-off',
    async (detectedBy, opts, queued) => {
      answers = [...queued]

      await step(
        useProvider('openai-compatible', opts),
        { firstCall: false },
        { actionId: 'act_1' },
      )

      expect(windowLogs()).toEqual([
        [
          'provider.context_window',
          expect.objectContaining({
            target: 'lore-mgmt',
            detectedBy,
            estimate: expect.any(Number),
          }),
          { actionId: 'act_1' },
        ],
      ])
      expect(cutLogs()).toEqual([])
    },
  )
})
