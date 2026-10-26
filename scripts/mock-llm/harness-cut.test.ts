import { wrapLanguageModel } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { JsonSchema } from '@/lib/ai'
import { jsonResponseFormatMiddleware, promptSchemaMiddleware } from '@/lib/ai/prompt-schema'
import { createProviderModel } from '@/lib/ai/providers'
import { runProviderCall, streamProviderCall } from '@/lib/ai/transport/provider-call'
import { fallbackClassifierSchema } from '@/lib/pipeline'

import { EXAMPLES, startMockLlm, type MockLlm } from '../../e2e/harness/mock-llm'

// Through the app's own provider, so the finish reason the E2E specs rely on is the one
// @ai-sdk/openai-compatible actually reports.

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
  onError?: () => void,
): Promise<{ text: string; finishReason: string }> {
  const stream = streamProviderCall({
    model: createProviderModel(provider(llm), 'mock'),
    prompt: 'Continue the scene.',
    ...(onError ? { onError } : {}),
  })
  let text = ''
  for await (const delta of stream.textStream) text += delta
  return { text, finishReason: await stream.finishReason }
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

describe('startMockLlm — a cut narrative', () => {
  it('streams the current narrative and finishes length, once', async () => {
    const llm = await started()
    llm.setNarrative('The rope bridge sways, and the far plank')
    llm.cutNextNarrative()

    expect(await narrativeCall(llm)).toEqual({
      text: 'The rope bridge sways, and the far plank',
      finishReason: 'length',
    })
    expect((await narrativeCall(llm)).finishReason).toBe('stop')
  })

  it('finishes a held stream length when it is released', async () => {
    const llm = await started()
    llm.holdNextNarrative()
    llm.cutNextNarrative()
    const held = narrativeCall(llm)
    await vi.waitFor(() => expect(llm.requests).toHaveLength(1))

    llm.releaseNarrative()

    expect((await held).finishReason).toBe('length')
  })

  it('keeps the cut through a failed call for the next stream', async () => {
    const llm = await started()
    llm.failNextNarrative()
    llm.cutNextNarrative()

    // The 500 streams nothing; how the SDK surfaces it is beside the point here.
    await narrativeCall(llm, () => {}).catch(() => null)

    expect((await narrativeCall(llm)).finishReason).toBe('length')
    expect(llm.requests).toHaveLength(2)
  })
})

describe('startMockLlm — a cut structured reply', () => {
  it('answers the raw text verbatim with finish_reason length, once, and records both calls', async () => {
    const llm = await started()
    const raw = '{"sceneEntities":[],"worldTime'
    llm.cutNextStructured('per-turn-classifier', raw)

    const cut = await classifierCall(llm)
    const next = await classifierCall(llm)

    expect(cut.text).toBe(raw)
    expect(cut.finishReason).toBe('length')
    expect(next.finishReason).toBe('stop')
    expect(JSON.parse(next.text)).toEqual(EXAMPLES['per-turn-classifier'])
    expect(llm.requests.map((r) => r.agent)).toEqual(['per-turn-classifier', 'per-turn-classifier'])
  })

  it('leaves another shape answering as before', async () => {
    const llm = await started()
    llm.cutNextStructured('periodic-classifier', '{"happenings":[')

    const call = await classifierCall(llm)

    expect(call.finishReason).toBe('stop')
    expect(JSON.parse(call.text)).toEqual(EXAMPLES['per-turn-classifier'])
  })
})
