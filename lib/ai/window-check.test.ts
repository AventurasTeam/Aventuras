import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { z } from 'zod'

import { logger, type Logger } from '@/lib/diagnostics'

import { countPromptTokens } from './context-window'
import { generateStructured, type PromptHalves } from './generate'
import { getModel } from './model'
import { schemaToTypeScriptBlock, type JsonSchema, type ModelPrompt } from './prompt-schema'
import { resolveModel, type ResolvedParams, type ResolveModelConfig } from './resolve-model'
import {
  __resetTruncationCheck,
  checkInputTokens,
  configureTruncationNotice,
} from './truncation-check'

// The real provider adapters over a capturing fetch, so each captured body is a request that went
// out. generate.test.ts fakes the provider call, where the window check never runs.
vi.mock('./model', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getModel: vi.fn(),
}))
vi.mock('./resolve-model', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  resolveModel: vi.fn(),
}))
vi.mock('./truncation-check', async (orig) => {
  const actual = await orig<Record<string, unknown>>()
  return { ...actual, checkInputTokens: vi.fn(actual.checkInputTokens as typeof checkInputTokens) }
})

type ProviderType = 'anthropic' | 'openai-compatible'
type Usage = { prompt_tokens: number; completion_tokens: number; total_tokens: number }

let bodies: Record<string, unknown>[] = []
// One answer per request a test expects; a request with none queued fails like a dead server.
let answers: (() => Response)[] = []

const capture: typeof fetch = async (_input, init) => {
  bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
  const answer = answers.shift()
  if (answer === undefined) throw new Error('no answer queued for this request')
  return answer()
}

function completion(
  content: string,
  opts: { finishReason?: 'stop' | 'length'; usage?: Usage } = {},
): () => Response {
  return () =>
    new Response(
      JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 0,
        model: 'm',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content },
            finish_reason: opts.finishReason ?? 'stop',
          },
        ],
        ...(opts.usage !== undefined ? { usage: opts.usage } : {}),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
}

// retry-after 0: a retrying call retries at once, so a missed short-circuit shows as a second body.
function rejection(status: number, body: unknown): () => Response {
  return () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'retry-after': '0' },
    })
}

const LLAMA_MESSAGE =
  'request (71834 tokens) exceeds the available context size (65536 tokens), try increasing it'
const LLAMA_OVERFLOW = {
  error: {
    code: 400,
    message: LLAMA_MESSAGE,
    type: 'exceed_context_size_error',
    n_prompt_tokens: 71834,
    n_ctx: 65536,
  },
}
const PLAIN_500 = { error: { message: 'upstream exploded', type: 'server_error' } }

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

function useProvider(
  type: ProviderType,
  opts: { window?: number; params?: ResolvedParams } = {},
): ResolveModelConfig {
  vi.mocked(getModel).mockReturnValue(MODELS[type]())
  vi.mocked(resolveModel).mockReturnValue({
    ok: true,
    providerId: 'prov',
    providerType: type,
    modelId: 'm',
    params: opts.params ?? {},
  })
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
    profiles: [],
    assignments: {},
  }
}

const schema = z.object({ summary: z.string() })
const CONTRACT = `Respond strictly with JSON. The JSON should be compatible with the TypeScript type Response from the following:\n\n${schemaToTypeScriptBlock(z.toJSONSchema(schema) as JsonSchema)}`
const CLOSING = 'Output ONLY the JSON object, no other text or markdown.'
const HALVES: PromptHalves = {
  system: '# Setting\nA drowned city.',
  user: '# Story so far\nThe bell rang.',
}

const asSent = (system: string, user: string): ModelPrompt => [
  { role: 'system', content: system },
  { role: 'user', content: [{ type: 'text', text: user }] },
]
// The narrative goes out as the halves; a structured call adds the JSON contract to both.
const BARE = countPromptTokens(asSent(HALVES.system, HALVES.user))
const SENT = countPromptTokens(
  asSent(`${HALVES.system}\n\n${CONTRACT}`, `${HALVES.user}\n\n${CLOSING}`),
)

let warn: MockInstance<Logger['warn']>
let debug: MockInstance<Logger['debug']>

beforeEach(() => {
  bodies = []
  answers = []
  __resetTruncationCheck()
  vi.mocked(checkInputTokens).mockClear()
  warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
  debug = vi.spyOn(logger, 'debug').mockImplementation(() => {})
})

afterEach(() => {
  warn.mockRestore()
  debug.mockRestore()
})

const windowLogs = () => warn.mock.calls.filter(([kind]) => kind === 'provider.context_window')

function structured(config: ResolveModelConfig, actionId: string | null = null) {
  return generateStructured('classifier', HALVES, schema, config, new AbortController().signal, {
    actionId,
  })
}

// architecture.md → The pre-send check.
describe('generateStructured: the window check', () => {
  // The window sits above the bare prompt's count, so only counting the contract refuses.
  it('refuses a call whose prompt as sent exceeds a known window, sending nothing', async () => {
    expect(BARE).toBeLessThan(SENT - 1)

    expect(await structured(useProvider('openai-compatible', { window: SENT - 1 }))).toEqual({
      status: 'failed',
      error: {
        tier: 'context-window',
        detectedBy: 'check',
        estimate: SENT,
        window: SENT - 1,
        windowSource: 'configured',
        providerId: 'prov',
        modelId: 'm',
      },
      recoverable: [],
    })
    expect(bodies).toEqual([])
    expect(checkInputTokens).not.toHaveBeenCalled()
  })

  it.each([
    ['equal to the estimate', SENT],
    ['unknown', undefined],
  ])('sends a call whose window is %s', async (_label, window) => {
    answers = [completion('{"summary":"A tale."}')]

    const res = await structured(
      useProvider('openai-compatible', window === undefined ? {} : { window }),
    )

    expect(res).toEqual({ status: 'ok', value: { summary: 'A tale.' }, recoverable: [] })
    expect(bodies).toHaveLength(1)
  })

  // Under force-on the schema rides response_format, not the prompt, so it isn't counted.
  it('counts the prompt alone under force-on', async () => {
    answers = [completion('{"summary":"A tale."}')]

    const res = await structured(
      useProvider('openai-compatible', {
        window: BARE,
        params: { structuredOutput: 'force-on' },
      }),
    )

    expect(res.status).toBe('ok')
    expect(bodies).toHaveLength(1)
  })

  it('warns once on a refusal, with the numbers and the action', async () => {
    await structured(useProvider('openai-compatible', { window: SENT - 1 }), 'act_1')

    expect(windowLogs()).toEqual([
      [
        'provider.context_window',
        {
          target: 'classifier',
          detectedBy: 'check',
          estimate: SENT,
          window: SENT - 1,
          windowSource: 'configured',
          providerId: 'prov',
          modelId: 'm',
        },
        { actionId: 'act_1' },
      ],
    ])
  })
})

// architecture.md → Recognizing an overflow rejection.
describe('generateStructured: an overflow rejection', () => {
  it.each([
    [400, undefined, { window: null, windowSource: 'unknown' }],
    [500, 100_000, { window: 100_000, windowSource: 'configured' }],
  ] as const)(
    'ends a %i overflow after one request, as provider-detected',
    async (status, window, known) => {
      answers = [rejection(status, LLAMA_OVERFLOW), rejection(status, LLAMA_OVERFLOW)]

      const res = await structured(
        useProvider('openai-compatible', window === undefined ? {} : { window }),
      )

      expect(res).toEqual({
        status: 'failed',
        error: {
          tier: 'context-window',
          detectedBy: 'provider',
          estimate: SENT,
          ...known,
          providerId: 'prov',
          modelId: 'm',
          detail: LLAMA_MESSAGE,
        },
        recoverable: [],
      })
      expect(bodies).toHaveLength(1)
    },
  )

  it('warns once on a rejection, quoting the provider, with no action outside a run', async () => {
    answers = [rejection(400, LLAMA_OVERFLOW)]

    await structured(useProvider('openai-compatible'), null)

    expect(windowLogs()).toEqual([
      [
        'provider.context_window',
        {
          target: 'classifier',
          detectedBy: 'provider',
          estimate: SENT,
          window: null,
          windowSource: 'unknown',
          providerId: 'prov',
          modelId: 'm',
          detail: LLAMA_MESSAGE,
        },
        undefined,
      ],
    ])
  })

  it('still retries a plain 500, and logs no window failure', async () => {
    answers = [rejection(500, PLAIN_500), rejection(500, PLAIN_500)]

    const res = await structured(useProvider('openai-compatible'))

    expect(res).toMatchObject({
      status: 'failed',
      error: { tier: 'provider', reason: 'network' },
      recoverable: [{ tier: 'provider', reason: 'network' }],
    })
    expect(bodies).toHaveLength(2)
    expect(windowLogs()).toEqual([])
  })
})

describe('generateStructured: after the reply', () => {
  // generation-pipeline.md → Cut-off replies: `window` needs both the window and the estimate.
  it('reads a length cut as window when the estimate and the output reach a known window', async () => {
    const window = SENT + 50
    answers = [
      completion('{"summary":"A ta', {
        finishReason: 'length',
        usage: { prompt_tokens: SENT, completion_tokens: 50, total_tokens: SENT + 50 },
      }),
    ]

    expect(await structured(useProvider('openai-compatible', { window }))).toEqual({
      status: 'failed',
      error: {
        tier: 'reply-cut-off',
        cause: 'window',
        outputTokens: 50,
        reasoningTokens: 0,
        maxOutput: null,
        window,
        providerId: 'prov',
        modelId: 'm',
      },
      recoverable: [],
    })
  })

  // architecture.md → Truncation cross-check: a parse retry is another call, checked on its own.
  it("checks each reply's reported input against the estimate", async () => {
    const sink = vi.fn()
    configureTruncationNotice(sink)
    const usage = { prompt_tokens: 1, completion_tokens: 5, total_tokens: 6 }
    answers = [
      completion('not json <<<', { usage }),
      completion('{"summary":"A tale."}', { usage }),
    ]

    expect((await structured(useProvider('openai-compatible'), 'act_1')).status).toBe('ok')

    const checked = {
      usage: expect.objectContaining({ inputTokens: 1 }),
      estimate: SENT,
      providerId: 'prov',
      modelId: 'm',
      actionId: 'act_1',
    }
    expect(vi.mocked(checkInputTokens).mock.calls).toEqual([[checked], [checked]])
    // The window check's debug estimate carries the run too, on each attempt.
    expect(
      debug.mock.calls.filter(([kind]) => kind === 'provider.prompt_estimate').map((c) => c[2]),
    ).toEqual([{ actionId: 'act_1' }, { actionId: 'act_1' }])
    expect(sink).toHaveBeenCalledExactlyOnceWith({
      providerId: 'prov',
      modelId: 'm',
      reported: 1,
      estimate: SENT,
    })
  })

  it('names no action outside a run', async () => {
    answers = [
      completion('{"summary":"A tale."}', {
        usage: { prompt_tokens: SENT, completion_tokens: 5, total_tokens: SENT + 5 },
      }),
    ]

    await structured(useProvider('openai-compatible'), null)

    expect(checkInputTokens).toHaveBeenCalledOnce()
    expect(vi.mocked(checkInputTokens).mock.calls[0]?.[0]).not.toHaveProperty('actionId')
    expect(
      debug.mock.calls.filter(([kind]) => kind === 'provider.prompt_estimate').map((c) => c[2]),
    ).toEqual([undefined])
  })
})
