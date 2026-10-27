import { APICallError, wrapLanguageModel, type LanguageModelUsage } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { JsonSchema } from '@/lib/ai'
import { jsonResponseFormatMiddleware, promptSchemaMiddleware } from '@/lib/ai/prompt-schema'
import { createProviderModel } from '@/lib/ai/providers'
import { recognizeOverflow } from '@/lib/ai/transport/classify-provider-error'
import { runProviderCall, streamProviderCall } from '@/lib/ai/transport/provider-call'
import { fallbackClassifierSchema } from '@/lib/pipeline'

import { overflowBody, overflowCounts } from './respond/wire'
import { STRUCTURED_SHAPES } from './shapes'
import {
  EXAMPLES,
  mockUsage,
  promptOf,
  startMockLlm,
  type MockLlm,
} from '../../e2e/harness/mock-llm'

// Through the app's own provider, so the usage and rejections the E2E specs rely on are the ones
// @ai-sdk/openai-compatible actually reads.

// Prose, not a repeated character (lessons-learned/token-fixtures-need-real-prose.md).
const PROMPT = Array(25).fill('The bell answers from across the water.').join(' ')
// o200k counts, measured: PROMPT as the SDK sends it (one user message), its tenth, and the
// harness's default narrative.
const PROMPT_TOKENS = 200
const UNDER_REPORTED = 20
const DEFAULT_NARRATIVE_TOKENS = 28

let mock: MockLlm | undefined

afterEach(async () => {
  await mock?.close()
  mock = undefined
})

async function started(): Promise<MockLlm> {
  mock = await startMockLlm()
  return mock
}

function provider(llm: MockLlm): Parameters<typeof createProviderModel>[0] {
  return {
    id: 'prov_harness',
    type: 'openai-compatible',
    displayName: 'Harness',
    apiKey: '',
    favoriteModelIds: [],
    endpoint: llm.url,
  }
}

async function narrativeCall(
  llm: MockLlm,
  prompt = PROMPT,
): Promise<{ text: string; finishReason: string; usage: LanguageModelUsage }> {
  const stream = streamProviderCall({
    model: createProviderModel(provider(llm), 'mock'),
    prompt,
  })
  let text = ''
  for await (const delta of stream.textStream) text += delta
  return { text, finishReason: await stream.finishReason, usage: await stream.usage }
}

/** A narrative call the server rejects: the SDK ends the stream empty and hands onError the error. */
async function narrativeError(llm: MockLlm): Promise<unknown> {
  let error: unknown
  const stream = streamProviderCall({
    model: createProviderModel(provider(llm), 'mock'),
    prompt: PROMPT,
    onError: ({ error: streamed }) => {
      error = streamed
    },
  })
  let text = ''
  for await (const delta of stream.textStream) text += delta
  expect(text).toBe('')
  return error
}

/** The fallback classifier's shape, so the harness routes it to 'per-turn-classifier'. */
function classifierCall(llm: MockLlm): ReturnType<typeof runProviderCall> {
  const model = wrapLanguageModel({
    model: createProviderModel(provider(llm), 'mock') as Parameters<
      typeof wrapLanguageModel
    >[0]['model'],
    middleware: [
      jsonResponseFormatMiddleware(z.toJSONSchema(fallbackClassifierSchema) as JsonSchema),
      promptSchemaMiddleware(),
    ],
  }) as Parameters<typeof runProviderCall>[0]['model']
  return runProviderCall({ model, prompt: 'Classify the turn.' })
}

function blockOf(name: string): string {
  const shape = STRUCTURED_SHAPES.find((s) => s.name === name)
  if (shape === undefined) throw new Error(`no structured shape named ${name}`)
  return shape.block
}

/** A raw request whose prompt carries `name`'s schema block, as the app's auto path sends it. */
function structuredCall(llm: MockLlm, name: string): Promise<Response> {
  return fetch(`${llm.url}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'mock',
      messages: [
        { role: 'system', content: blockOf(name) },
        { role: 'user', content: 'Classify the turn.' },
      ],
    }),
  })
}

/** A raw streaming request that asks for usage, the way the app's provider does. */
function streamWithUsage(llm: MockLlm, prompt = PROMPT): Promise<Response> {
  return fetch(`${llm.url}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'mock',
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: 'user', content: prompt }],
    }),
  })
}

/** The usage object on the wire: the SDK recomputes its totals, so only the raw frame pins them. */
function wireUsage(sse: string): {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
} {
  const frames = sse.split('\n\n').filter((f) => f.startsWith('data: {'))
  const usage = frames
    .map((f) => JSON.parse(f.slice('data: '.length)) as { usage?: ReturnType<typeof wireUsage> })
    .find((f) => f.usage !== undefined)?.usage
  if (usage === undefined) throw new Error('no usage frame on the stream')
  return usage
}

/** Whether `promise` is still unsettled after a beat; a held call stays so until released. */
async function staysPending(promise: Promise<unknown>): Promise<boolean> {
  let settled = false
  void promise.then(
    () => (settled = true),
    () => (settled = true),
  )
  await new Promise((resolve) => setTimeout(resolve, 100))
  return !settled
}

const statusOf = (error: unknown): number | null =>
  APICallError.isInstance(error) ? (error.statusCode ?? null) : null

describe('startMockLlm — usage', () => {
  it('reports usage on a narrative stream that asks, counted over the prompt and the reply', async () => {
    const llm = await started()

    const call = await narrativeCall(llm)

    expect(call.usage).toMatchObject({
      inputTokens: PROMPT_TOKENS,
      outputTokens: DEFAULT_NARRATIVE_TOKENS,
    })
  })

  it('sends no usage on a stream that does not ask for it', async () => {
    const llm = await started()
    const response = await fetch(`${llm.url}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'mock',
        stream: true,
        messages: [{ role: 'user', content: PROMPT }],
      }),
    })

    expect(await response.text()).not.toContain('"usage"')
  })

  it('reports usage on a structured reply, counted over the prompt it matched and the reply', async () => {
    const llm = await started()

    const result = await classifierCall(llm)

    const expected = mockUsage(promptOf(llm.requests[0]), result.text)
    expect(expected.prompt_tokens).toBeGreaterThan(0)
    expect(result.usage).toMatchObject({
      inputTokens: expected.prompt_tokens,
      outputTokens: expected.completion_tokens,
    })
  })

  it('under-reports the next narrative stream to a tenth of its prompt count, once', async () => {
    const llm = await started()
    llm.underReportNextUsage()

    const structured = await classifierCall(llm)
    const low = await narrativeCall(llm)
    const full = await narrativeCall(llm)

    // A structured reply doesn't spend it.
    expect(structured.usage.inputTokens).toBe(
      mockUsage(promptOf(llm.requests[0]), structured.text).prompt_tokens,
    )
    expect(low.usage).toMatchObject({
      inputTokens: UNDER_REPORTED,
      outputTokens: DEFAULT_NARRATIVE_TOKENS,
    })
    expect(full.usage.inputTokens).toBe(PROMPT_TOKENS)
  })

  it('recomputes the under-reported total on the wire, which the SDK never reads', async () => {
    const llm = await started()
    llm.underReportNextUsage()

    const usage = wireUsage(await (await streamWithUsage(llm)).text())

    expect(usage).toEqual({
      prompt_tokens: UNDER_REPORTED,
      completion_tokens: DEFAULT_NARRATIVE_TOKENS,
      total_tokens: UNDER_REPORTED + DEFAULT_NARRATIVE_TOKENS,
    })
  })

  it('reports a held structured reply counted over the prompt it held, at release', async () => {
    const llm = await started()
    llm.holdNextStructured('per-turn-classifier')
    const held = classifierCall(llm)
    await vi.waitFor(() => expect(llm.requests).toHaveLength(1))

    llm.releaseStructured()
    const result = await held

    const expected = mockUsage(promptOf(llm.requests[0]), result.text)
    expect(expected.prompt_tokens).toBeGreaterThan(0)
    expect(result.usage).toMatchObject({
      inputTokens: expected.prompt_tokens,
      outputTokens: expected.completion_tokens,
    })
  })

  it('never under-reports to 0, which the app reads as no count at all', async () => {
    const llm = await started()
    llm.underReportNextUsage()

    // 'Continue the scene.' is 4 tokens, whose tenth floors to 0.
    expect((await narrativeCall(llm, 'Continue the scene.')).usage.inputTokens).toBe(1)
  })

  it('gives a held stream its usage at release, with an under-report armed after it arrived', async () => {
    const llm = await started()
    llm.holdNextNarrative()
    const held = narrativeCall(llm)
    await vi.waitFor(() => expect(llm.requests).toHaveLength(1))

    llm.underReportNextUsage()
    llm.releaseNarrative()

    expect((await held).usage.inputTokens).toBe(UNDER_REPORTED)
  })
})

describe('startMockLlm — an overflow rejection', () => {
  it.each([
    [undefined, 'exceeds the available context size'],
    ['openai', 'maximum context length'],
  ] as const)(
    'rejects the next narrative call with a 400 (shape %s), once, and records it',
    async (shape, phrase) => {
      const llm = await started()
      llm.overflowNextNarrative(shape)

      const error = await narrativeError(llm)

      expect(statusOf(error)).toBe(400)
      expect(recognizeOverflow(error)?.detail).toContain(phrase)
      expect((await narrativeCall(llm)).finishReason).toBe('stop')
      expect(llm.requests.map((r) => r.streamed)).toEqual([true, true])
    },
  )

  it('rejects the next call of that shape with a 400, once, and records it', async () => {
    const llm = await started()
    llm.overflowNextStructured('per-turn-classifier', 'openai')

    const error = await classifierCall(llm).then(
      () => null,
      (rejected: unknown) => rejected,
    )
    const next = await classifierCall(llm)

    expect(statusOf(error)).toBe(400)
    expect(recognizeOverflow(error)?.detail).toContain('maximum context length')
    expect(JSON.parse(next.text)).toEqual(EXAMPLES['per-turn-classifier'])
    expect(llm.requests.map((r) => r.agent)).toEqual(['per-turn-classifier', 'per-turn-classifier'])
  })

  it("defaults to llama.cpp's shape, and lets another shape through", async () => {
    const llm = await started()
    llm.overflowNextStructured('periodic-classifier')

    const other = await classifierCall(llm)
    const rejected = await structuredCall(llm, 'periodic-classifier')

    expect(JSON.parse(other.text)).toEqual(EXAMPLES['per-turn-classifier'])
    expect(rejected.status).toBe(400)
    expect(((await rejected.json()) as { error: { type: string } }).error.type).toBe(
      'exceed_context_size_error',
    )
    expect(llm.requests.map((r) => r.agent)).toEqual(['per-turn-classifier', 'periodic-classifier'])
  })

  it.each(['llamacpp', 'openai'] as const)(
    'writes the %s body at the counted prompt, on both paths',
    async (shape) => {
      const llm = await started()
      llm.overflowNextNarrative(shape)
      llm.overflowNextStructured('per-turn-classifier', shape)

      const narrative = await streamWithUsage(llm)
      const structured = await structuredCall(llm, 'per-turn-classifier')

      expect(narrative.status).toBe(400)
      expect(await narrative.text()).toBe(overflowBody(shape, overflowCounts(PROMPT)))
      const sent = promptOf(llm.requests[1])
      expect(overflowCounts(sent).prompt).toBeGreaterThan(0)
      expect(structured.status).toBe(400)
      expect(await structured.text()).toBe(overflowBody(shape, overflowCounts(sent)))
    },
  )

  it('answers an armed overflow before a hold or a cut, which stay armed for the next call', async () => {
    const llm = await started()
    llm.holdNextNarrative()
    llm.cutNextNarrative()
    llm.overflowNextNarrative()

    expect((await streamWithUsage(llm)).status).toBe(400)
    const held = narrativeCall(llm)
    await vi.waitFor(() => expect(llm.requests).toHaveLength(2))
    expect(await staysPending(held)).toBe(true)
    llm.releaseNarrative()

    expect((await held).finishReason).toBe('length')
  })

  it('answers an armed structured overflow before a hold or a cut on that shape, which stay armed', async () => {
    const llm = await started()
    llm.holdNextStructured('per-turn-classifier')
    llm.cutNextStructured('per-turn-classifier', '{"half":')
    llm.overflowNextStructured('per-turn-classifier')

    expect((await structuredCall(llm, 'per-turn-classifier')).status).toBe(400)
    const held = classifierCall(llm)
    await vi.waitFor(() => expect(llm.requests).toHaveLength(2))
    expect(await staysPending(held)).toBe(true)
    llm.releaseStructured()

    const released = await held
    expect(released.text).toBe('{"half":')
    expect(released.finishReason).toBe('length')
  })
})
