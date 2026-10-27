import { APICallError, generateText, wrapLanguageModel, type LanguageModelMiddleware } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { z } from 'zod'

import { logger, type Logger } from '@/lib/diagnostics'
import { countTokens } from '@/lib/retrieval'

import type { ProviderInstance } from '../db'
import {
  ContextWindowError,
  countPromptTokens,
  describeContextWindow,
  displayEstimate,
  generationWindow,
  windowCheckMiddleware,
  type ContextWindowFailure,
  type GenerationWindow,
} from './context-window'
import {
  jsonResponseFormatMiddleware,
  promptSchemaMiddleware,
  type JsonSchema,
  type ModelPrompt,
} from './prompt-schema'

type GenerateResult = Awaited<ReturnType<MockLanguageModelV3['doGenerate']>>
type StreamResult = Awaited<ReturnType<MockLanguageModelV3['doStream']>>

const base = {
  type: 'openai-compatible' as const,
  displayName: 'Local',
  apiKey: '',
  favoriteModelIds: [],
}

const PROVIDERS: ProviderInstance[] = [
  {
    ...base,
    id: 'prov-1',
    cachedModels: [
      { id: 'gemma', capabilities: { contextWindow: 65536 } },
      { id: 'qwen', capabilities: { contextWindow: 32768 } },
      { id: 'flags-only', capabilities: { reasoning: true } },
      { id: 'bare' },
    ],
    customModelIds: ['my-finetune'],
    contextWindowOverrides: { qwen: 16384, 'my-finetune': 8192 },
  },
  {
    ...base,
    id: 'prov-2',
    cachedModels: [{ id: 'gemma', capabilities: { contextWindow: 131072 } }],
  },
]

describe('generationWindow', () => {
  it('takes the configured figure over the detected one', () => {
    expect(generationWindow(PROVIDERS, 'prov-1', 'qwen')).toEqual({
      tokens: 16384,
      source: 'configured',
    })
  })

  it('takes a configured figure for a custom model the catalog never listed', () => {
    expect(generationWindow(PROVIDERS, 'prov-1', 'my-finetune')).toEqual({
      tokens: 8192,
      source: 'configured',
    })
  })

  it('falls back to the detected figure', () => {
    expect(generationWindow(PROVIDERS, 'prov-1', 'gemma')).toEqual({
      tokens: 65536,
      source: 'detected',
    })
  })

  it("reads the call's own provider for a model id two providers share", () => {
    expect(generationWindow(PROVIDERS, 'prov-2', 'gemma')).toEqual({
      tokens: 131072,
      source: 'detected',
    })
  })

  it.each(['flags-only', 'bare', 'unlisted'])('is unknown for %s, never assumed', (modelId) => {
    expect(generationWindow(PROVIDERS, 'prov-1', modelId)).toEqual({
      tokens: null,
      source: 'unknown',
    })
  })

  it('is unknown for a provider that is not configured', () => {
    expect(generationWindow(PROVIDERS, 'prov-gone', 'gemma')).toEqual({
      tokens: null,
      source: 'unknown',
    })
  })

  // Only prov-1 configures qwen.
  it.each(['prov-2', 'prov-gone'])(
    "never reads another provider's configured figure (%s)",
    (id) => {
      expect(generationWindow(PROVIDERS, id, 'qwen')).toEqual({ tokens: null, source: 'unknown' })
    },
  )

  it('reads no inherited property as a configured figure', () => {
    expect(generationWindow(PROVIDERS, 'prov-1', 'constructor')).toEqual({
      tokens: null,
      source: 'unknown',
    })
  })
})

const CHECK_FAILURE: ContextWindowFailure = {
  detectedBy: 'check',
  estimate: 71234,
  window: 65536,
  windowSource: 'configured',
  providerId: 'prov-1',
  modelId: 'gemma',
}

describe('describeContextWindow', () => {
  it('names the check, the numbers and the model', () => {
    expect(describeContextWindow(CHECK_FAILURE)).toBe(
      'prompt over the context window (check): estimate 71234 tokens, window 65536 (configured); ' +
        'model gemma on provider prov-1',
    )
  })

  it("ends a provider rejection with the provider's message", () => {
    expect(
      describeContextWindow({
        ...CHECK_FAILURE,
        detectedBy: 'provider',
        windowSource: 'detected',
        detail: 'request (71834 tokens) exceeds the available context size (65536 tokens)',
      }),
    ).toBe(
      'prompt over the context window (provider): estimate 71234 tokens, window 65536 (detected); ' +
        'model gemma on provider prov-1: ' +
        'request (71834 tokens) exceeds the available context size (65536 tokens)',
    )
  })

  it('leaves out an unknown window and an absent message', () => {
    expect(
      describeContextWindow({
        ...CHECK_FAILURE,
        detectedBy: 'provider',
        window: null,
        windowSource: 'unknown',
      }),
    ).toBe(
      'prompt over the context window (provider): estimate 71234 tokens; model gemma on provider prov-1',
    )
  })

  it('leaves a blank provider message off the line', () => {
    expect(describeContextWindow({ ...CHECK_FAILURE, detectedBy: 'provider', detail: '  ' })).toBe(
      'prompt over the context window (provider): estimate 71234 tokens, window 65536 (configured); ' +
        'model gemma on provider prov-1',
    )
  })
})

describe('ContextWindowError', () => {
  it('carries the failure, with its line as the message', () => {
    const error = new ContextWindowError(CHECK_FAILURE)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ContextWindowError')
    expect(error.failure).toBe(CHECK_FAILURE)
    expect(error.message).toBe(
      'prompt over the context window (check): estimate 71234 tokens, window 65536 (configured); ' +
        'model gemma on provider prov-1',
    )
  })
})

describe('countPromptTokens', () => {
  it('sums the system content and the text parts of user and assistant messages', () => {
    const prompt: ModelPrompt = [
      { role: 'system', content: 'Rules of the house.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'First, the door.' },
          { type: 'text', text: 'Then the stairs.' },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'The door creaks open.' }] },
    ]
    expect(countPromptTokens(prompt)).toBe(
      countTokens('Rules of the house.') +
        countTokens('First, the door.') +
        countTokens('Then the stairs.') +
        countTokens('The door creaks open.'),
    )
  })

  it('counts every other part type as 0', () => {
    const prompt: ModelPrompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look.' },
          { type: 'file', data: 'aGVsbG8gd29ybGQ=', mediaType: 'text/plain' },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'A long chain of private thought about the door.' },
          { type: 'text', text: 'Fine.' },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'lookup',
            output: { type: 'text', value: 'A tool result the count skips.' },
          },
        ],
      },
    ]
    expect(countPromptTokens(prompt)).toBe(countTokens('Look.') + countTokens('Fine.'))
  })

  it('is 0 for an empty prompt', () => {
    expect(countPromptTokens([])).toBe(0)
  })
})

const SYSTEM = 'You narrate a drowned city in the second person.'
const USER = 'The bell rang twice. What do I see from the tower?'
const PROMPT: ModelPrompt = [
  { role: 'system', content: SYSTEM },
  { role: 'user', content: [{ type: 'text', text: USER }] },
]
const ESTIMATE = countTokens(SYSTEM) + countTokens(USER)

function checkMiddleware(window: GenerationWindow) {
  const onEstimate = vi.fn<(estimate: number) => void>()
  const middleware = windowCheckMiddleware({
    window,
    providerId: 'prov-1',
    modelId: 'model-1',
    onEstimate,
  })
  return { middleware, onEstimate }
}

const GENERATED: GenerateResult = {
  content: [{ type: 'text', text: '{"summary":"A bell."}' }],
  finishReason: { unified: 'stop', raw: 'stop' },
  usage: {
    inputTokens: {
      total: undefined,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  },
  warnings: [],
}
const STREAMED: StreamResult = { stream: new ReadableStream() }

const HOOKS = ['generate', 'stream'] as const
type Hook = (typeof HOOKS)[number]

const unsent = (): never => {
  throw new Error('the other hook sent the request')
}

// PROMPT through the middleware's `hook`, around a model call that answers, or throws `error`.
function sendThrough(
  middleware: LanguageModelMiddleware,
  hook: Hook = 'generate',
  error?: unknown,
) {
  const options = { params: { prompt: PROMPT }, model: {} as never }
  if (hook === 'generate') {
    const send = vi.fn(async () => {
      if (error !== undefined) throw error
      return GENERATED
    })
    const pending = middleware.wrapGenerate!({ ...options, doGenerate: send, doStream: unsent })
    return { send, pending, answer: GENERATED }
  }
  const send = vi.fn(async () => {
    if (error !== undefined) throw error
    return STREAMED
  })
  const pending = middleware.wrapStream!({ ...options, doGenerate: unsent, doStream: send })
  return { send, pending, answer: STREAMED }
}

const OVERFLOW_MESSAGE =
  'request (71834 tokens) exceeds the available context size (65536 tokens), try increasing it'

function rejection(statusCode: number, body: unknown): APICallError {
  return new APICallError({
    message: 'Bad Request',
    url: 'http://127.0.0.1:9/v1/chat/completions',
    requestBodyValues: {},
    statusCode,
    responseBody: JSON.stringify(body),
  })
}

async function refusalOf(pending: PromiseLike<unknown>): Promise<ContextWindowError> {
  try {
    await pending
  } catch (error) {
    if (error instanceof ContextWindowError) return error
    throw error
  }
  throw new Error('expected a ContextWindowError; the call went through')
}

describe('windowCheckMiddleware', () => {
  let debug: MockInstance<Logger['debug']>

  beforeEach(() => {
    debug = vi.spyOn(logger, 'debug').mockImplementation(() => {})
  })
  afterEach(() => {
    debug.mockRestore()
  })

  const estimateLogs = () =>
    debug.mock.calls
      .filter(([kind]) => kind === 'provider.prompt_estimate')
      .map(([, fields]) => fields)

  it.each(HOOKS)('refuses a prompt over a known window, unsent, on %s', async (hook) => {
    const { middleware } = checkMiddleware({ tokens: ESTIMATE - 1, source: 'configured' })
    const { send, pending } = sendThrough(middleware, hook)
    const error = await refusalOf(pending)
    expect(error.failure).toStrictEqual({
      detectedBy: 'check',
      estimate: ESTIMATE,
      window: ESTIMATE - 1,
      windowSource: 'configured',
      providerId: 'prov-1',
      modelId: 'model-1',
    })
    expect(send).not.toHaveBeenCalled()
  })

  it.each(HOOKS)('sends a prompt exactly at the window on %s', async (hook) => {
    const { middleware } = checkMiddleware({ tokens: ESTIMATE, source: 'detected' })
    const { send, pending, answer } = sendThrough(middleware, hook)
    expect(await pending).toBe(answer)
    expect(send).toHaveBeenCalledOnce()
  })

  it('sends a prompt under the window', async () => {
    const { middleware } = checkMiddleware({ tokens: ESTIMATE + 1, source: 'detected' })
    expect(await sendThrough(middleware).pending).toBe(GENERATED)
  })

  it('skips the comparison for an unknown window but still reports the estimate', async () => {
    const { middleware, onEstimate } = checkMiddleware({ tokens: null, source: 'unknown' })
    expect(await sendThrough(middleware).pending).toBe(GENERATED)
    expect(onEstimate).toHaveBeenCalledTimes(1)
    expect(onEstimate).toHaveBeenCalledWith(ESTIMATE)
  })

  it('reports the estimate before refusing', async () => {
    const { middleware, onEstimate } = checkMiddleware({ tokens: 1, source: 'configured' })
    await refusalOf(sendThrough(middleware).pending)
    expect(onEstimate).toHaveBeenCalledTimes(1)
    expect(onEstimate).toHaveBeenCalledWith(ESTIMATE)
  })

  it('logs the estimate at debug on every call, a refused one included', async () => {
    await sendThrough(checkMiddleware({ tokens: null, source: 'unknown' }).middleware).pending
    await refusalOf(
      sendThrough(checkMiddleware({ tokens: 1, source: 'configured' }).middleware).pending,
    )
    expect(estimateLogs()).toEqual([
      {
        providerId: 'prov-1',
        modelId: 'model-1',
        estimate: ESTIMATE,
        window: null,
        windowSource: 'unknown',
        ms: expect.any(Number),
      },
      {
        providerId: 'prov-1',
        modelId: 'model-1',
        estimate: ESTIMATE,
        window: 1,
        windowSource: 'configured',
        ms: expect.any(Number),
      },
    ])
  })

  it('attributes the estimate log to its run when given an actionId', async () => {
    const attributed = windowCheckMiddleware({
      window: { tokens: null, source: 'unknown' },
      providerId: 'prov-1',
      modelId: 'model-1',
      onEstimate: () => {},
      actionId: 'act-1',
    })
    await sendThrough(attributed).pending
    await sendThrough(checkMiddleware({ tokens: null, source: 'unknown' }).middleware).pending
    const calls = debug.mock.calls.filter(([kind]) => kind === 'provider.prompt_estimate')
    expect(calls.map((call) => call[2])).toEqual([{ actionId: 'act-1' }, undefined])
  })

  // architecture.md → Recognizing an overflow rejection.
  it.each([
    ['generate', { tokens: null, source: 'unknown' }, { window: null, windowSource: 'unknown' }],
    ['stream', { tokens: null, source: 'unknown' }, { window: null, windowSource: 'unknown' }],
    [
      'generate',
      { tokens: ESTIMATE + 1, source: 'detected' },
      { window: ESTIMATE + 1, windowSource: 'detected' },
    ],
    [
      'stream',
      { tokens: ESTIMATE + 1, source: 'detected' },
      { window: ESTIMATE + 1, windowSource: 'detected' },
    ],
  ] as const)(
    'reads a recognized overflow on %s as provider-detected, under the window %o',
    async (hook, window, known) => {
      const overflow = rejection(400, {
        error: { message: OVERFLOW_MESSAGE, type: 'exceed_context_size_error' },
      })
      const { pending } = sendThrough(checkMiddleware(window).middleware, hook, overflow)
      expect((await refusalOf(pending)).failure).toStrictEqual({
        detectedBy: 'provider',
        estimate: ESTIMATE,
        ...known,
        providerId: 'prov-1',
        modelId: 'model-1',
        detail: OVERFLOW_MESSAGE,
      })
    },
  )

  it.each(HOOKS)('rethrows any other error from the model as it is, on %s', async (hook) => {
    const failure = rejection(500, { error: { message: 'upstream exploded' } })
    const { middleware } = checkMiddleware({ tokens: ESTIMATE + 1, source: 'detected' })
    await expect(sendThrough(middleware, hook, failure).pending).rejects.toBe(failure)
  })
})

// A structured call's chain, as generateStructured builds it: the check runs last.
describe('windowCheckMiddleware last in a chain', () => {
  const SCHEMA = z.toJSONSchema(z.object({ summary: z.string() })) as JsonSchema

  function structuredCall(window: GenerationWindow) {
    const sent = new MockLanguageModelV3({ doGenerate: async () => GENERATED })
    const onEstimate = vi.fn<(estimate: number) => void>()
    const model = wrapLanguageModel({
      model: sent,
      middleware: [
        jsonResponseFormatMiddleware(SCHEMA),
        promptSchemaMiddleware(),
        windowCheckMiddleware({ window, providerId: 'prov-1', modelId: 'model-1', onEstimate }),
      ],
    })
    const call = generateText({ model, system: SYSTEM, prompt: USER, maxRetries: 0 })
    return { sent, onEstimate, call }
  }

  it('counts the prompt the model receives, the injected contract included', async () => {
    const { sent, onEstimate, call } = structuredCall({ tokens: null, source: 'unknown' })
    await call
    expect(sent.doGenerateCalls).toHaveLength(1)
    const estimate = onEstimate.mock.calls[0]?.[0]
    expect(estimate).toBe(countPromptTokens(sent.doGenerateCalls[0].prompt))
    expect(estimate).toBeGreaterThan(ESTIMATE)
  })

  it('refuses, unsent, a window the bare prompt fits but the contract overflows', async () => {
    const { sent, call } = structuredCall({ tokens: ESTIMATE, source: 'detected' })
    const error = await refusalOf(call)
    expect(error.failure.window).toBe(ESTIMATE)
    expect(error.failure.windowSource).toBe('detected')
    expect(error.failure.estimate).toBeGreaterThan(ESTIMATE)
    expect(sent.doGenerateCalls).toHaveLength(0)
  })
})

describe('displayEstimate', () => {
  it.each([
    [0, 0],
    [999, 999],
    [1_000, 1_000],
    [1_001, 1_100],
    [1_100, 1_100],
    [65_537, 65_600],
    [71_234, 71_300],
  ])('prints %i as %i', (tokens, shown) => {
    expect(displayEstimate(tokens)).toBe(shown)
  })
})
