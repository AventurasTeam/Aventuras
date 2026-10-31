import { APICallError, wrapLanguageModel } from 'ai'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { fetchModelCatalog, parseStructured, replyStopOf } from '@/lib/ai'
import type { JsonSchema } from '@/lib/ai'
import { jsonResponseFormatMiddleware, promptSchemaMiddleware } from '@/lib/ai/prompt-schema'
import { createProviderModel } from '@/lib/ai/providers'
import { recognizeOverflow } from '@/lib/ai/transport/classify-provider-error'
import { runProviderCall, streamProviderCall } from '@/lib/ai/transport/provider-call'
import { parseStateBlock, parseSuggestionsBlock, stripTrailingBlocks } from '@/lib/piggyback'
import { fallbackClassifierSchema } from '@/lib/pipeline'

import { mockUsage } from './respond/wire'
import { startMockServer, type MockServer } from './server'

// The seam the other suites stop short of: the app's own provider construction
// and transport (createProviderModel -> @ai-sdk/openai-compatible ->
// createFetchWithCapture) talking to this server, rather than a hand-built
// fetch. A wire-format regression that the raw-HTTP tests would accept but the
// SDK would choke on fails here.

let mock: MockServer

beforeAll(async () => {
  mock = await startMockServer(0, { persist: false })
})

afterAll(async () => {
  await mock.close()
})

const provider = (): Parameters<typeof createProviderModel>[0] => ({
  id: 'prov_probe',
  type: 'openai-compatible',
  displayName: 'Mock',
  apiKey: '',
  favoriteModelIds: [],
  endpoint: mock.url,
})

/** A structured call wrapped the way lib/ai wraps it. */
function classifierModel(): Parameters<typeof runProviderCall>[0]['model'] {
  return wrapLanguageModel({
    model: createProviderModel(provider(), 'seed/narrative') as Parameters<
      typeof wrapLanguageModel
    >[0]['model'],
    middleware: [
      jsonResponseFormatMiddleware(z.toJSONSchema(fallbackClassifierSchema) as JsonSchema),
      promptSchemaMiddleware(),
    ],
  })
}

// What each shape's message says, as recognizeOverflow hands it on verbatim.
const OVERFLOW_PHRASE = {
  'overflow-llamacpp': 'exceeds the available context size',
  'overflow-openai': 'maximum context length',
} as const

describe('the app transport against the mock', () => {
  it('assembles a paced narrative stream back into prose and its trailing blocks', async () => {
    const lane = mock.ctx.lane('narrative')
    lane.stream = { charsPerSecond: 100_000, chunkSize: 6 }
    lane.activeId = lane.responses.find((r) => r.name === 'With suggestions')?.id ?? lane.activeId

    const stream = streamProviderCall({
      model: createProviderModel(provider(), 'seed/narrative'),
      prompt: 'Continue the scene.',
    })

    let assembled = ''
    for await (const delta of stream.textStream) assembled += delta

    expect(stripTrailingBlocks(assembled).prose).toBe(
      'The rain does not stop. It only changes its mind about direction.',
    )

    const state = parseStateBlock(assembled)
    expect(state.failures).toEqual([])
    expect(state.block.worldTimeDelta).toBe(120)
    expect(state.block.summary).toBe('The storm shifts.')

    expect(parseSuggestionsBlock(assembled).items.map((i) => i.categoryRef)).toEqual([
      'cat1',
      'cat2',
      'cat3',
    ])
  })

  it('round-trips a structured call through the real middleware and parser', async () => {
    const model = classifierModel()

    const result = await runProviderCall({ model, prompt: 'Classify the turn.' })
    const value = parseStructured(result.text, fallbackClassifierSchema)

    expect(value).toMatchObject({ sceneEntities: [], worldTimeDelta: 0 })
    // The middleware's injected block is what the mock routed on: proof the
    // lane match works on a prompt the app built, not one the test built.
    expect(mock.ctx.log.list().find((e) => !e.streamed)?.lane).toBe('per-turn-classifier')
  })

  it('surfaces an injected HTTP failure to the transport as an error', async () => {
    mock.ctx.lane('per-turn-classifier').failure = { kind: 'http', status: 503, remaining: 1 }

    const model = classifierModel()

    await expect(runProviderCall({ model, prompt: 'Classify the turn.' })).rejects.toThrow()
  })

  // generation-pipeline.md → Cut-off replies rests on what the SDK reports for each ending.
  it.each([
    ['a whole reply', 'none', null],
    ['a length stop', 'length', 'length'],
    ['a stream with no finish frame', 'stream-cut', 'interrupted'],
  ] as const)('reads %s as the stop it was', async (_label, kind, stop) => {
    const lane = mock.ctx.lane('narrative')
    lane.failure = { kind, status: 500, remaining: kind === 'none' ? 0 : 1 }
    const stream = streamProviderCall({
      model: createProviderModel(provider(), 'seed/narrative'),
      prompt: 'Continue the scene.',
    })

    await stream.consumeStream()

    expect(replyStopOf(await stream.finishReason, await stream.rawFinishReason)).toBe(stop)
    lane.failure = { kind: 'none', status: 500, remaining: 0 }
  })

  it("reports a lane's length failure as the SDK's finishReason on both paths", async () => {
    mock.ctx.lane('per-turn-classifier').failure = { kind: 'length', status: 500, remaining: 1 }
    const structured = await runProviderCall({
      model: classifierModel(),
      prompt: 'Classify the turn.',
    })
    expect(structured.finishReason).toBe('length')
    expect(() => JSON.parse(structured.text)).toThrow()

    const lane = mock.ctx.lane('narrative')
    lane.stream = { charsPerSecond: 100_000, chunkSize: 6 }
    lane.failure = { kind: 'length', status: 500, remaining: 1 }
    const stream = streamProviderCall({
      model: createProviderModel(provider(), 'seed/narrative'),
      prompt: 'Continue the scene.',
    })
    let assembled = ''
    for await (const delta of stream.textStream) assembled += delta

    expect(await stream.finishReason).toBe('length')
    expect(assembled.length).toBeGreaterThan(0)
  })

  it("hands the catalog fetch every model's window", async () => {
    const entries = await fetchModelCatalog(provider())

    expect(entries.map((e) => e.id)).toEqual(['seed/narrative', 'mock/no-tagged-block'])
    expect(entries.map((e) => e.contextWindow)).toEqual([131072, 131072])
  })

  it('reports usage the SDK reads as input and output tokens, on both paths', async () => {
    mock.ctx.log.clear()
    const structured = await runProviderCall({
      model: classifierModel(),
      prompt: 'Classify the turn.',
    })
    const sent = mock.ctx.log.list()[0]
    const expected = mockUsage(sent?.prompt ?? '', structured.text)
    expect(expected.prompt_tokens).toBeGreaterThan(0)
    expect(structured.usage).toMatchObject({
      inputTokens: expected.prompt_tokens,
      outputTokens: expected.completion_tokens,
    })

    mock.ctx.lane('narrative').stream = { charsPerSecond: 100_000, chunkSize: 6 }
    const stream = streamProviderCall({
      model: createProviderModel(provider(), 'seed/narrative'),
      prompt: 'Continue the scene.',
    })
    let assembled = ''
    for await (const delta of stream.textStream) assembled += delta

    // 'Continue the scene.' is 4 o200k tokens; the stream reports usage only because the app's
    // provider asks for it (includeUsage).
    expect(await stream.usage).toMatchObject({
      inputTokens: 4,
      outputTokens: mockUsage('', assembled).completion_tokens,
    })
  })

  it.each(['overflow-llamacpp', 'overflow-openai'] as const)(
    'delivers a %s rejection as an APICallError the app recognizes, on both paths',
    async (kind) => {
      mock.ctx.lane('per-turn-classifier').failure = { kind, status: 500, remaining: 1 }
      const structured = await runProviderCall({
        model: classifierModel(),
        prompt: 'Classify the turn.',
      }).then(
        () => null,
        (error: unknown) => error,
      )
      expect(APICallError.isInstance(structured) ? structured.statusCode : null).toBe(400)
      expect(recognizeOverflow(structured)?.detail).toContain(OVERFLOW_PHRASE[kind])

      mock.ctx.lane('narrative').failure = { kind, status: 500, remaining: 1 }
      let streamed: unknown
      const stream = streamProviderCall({
        model: createProviderModel(provider(), 'seed/narrative'),
        prompt: 'Continue the scene.',
        onError: ({ error }) => {
          streamed = error
        },
      })
      let text = ''
      for await (const delta of stream.textStream) text += delta

      expect(text).toBe('')
      expect(APICallError.isInstance(streamed) ? streamed.statusCode : null).toBe(400)
      expect(recognizeOverflow(streamed)?.detail).toContain(OVERFLOW_PHRASE[kind])
    },
  )
})
