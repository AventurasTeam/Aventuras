import { wrapLanguageModel } from 'ai'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { parseStructured } from '@/lib/ai'
import type { JsonSchema } from '@/lib/ai'
import { jsonResponseFormatMiddleware, promptSchemaMiddleware } from '@/lib/ai/prompt-schema'
import { createProviderModel } from '@/lib/ai/providers'
import { runProviderCall, streamProviderCall } from '@/lib/ai/transport/provider-call'
import { parseStateBlock, parseSuggestionsBlock, stripTrailingBlocks } from '@/lib/piggyback'
import { fallbackClassifierSchema } from '@/lib/pipeline'

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
})
