import { describe, expect, it, vi } from 'vitest'

import { createProviderModel } from '@/lib/ai/providers'
import { streamProviderCall } from '@/lib/ai/transport/provider-call'

import { classifierCall, harnessPerTest, provider } from './harness-calls'
import { EXAMPLES, type MockLlm } from '../../e2e/harness/mock-llm'

// Through the app's own provider, so the finish reason the E2E specs rely on is the one
// @ai-sdk/openai-compatible actually reports.

const started = harnessPerTest()

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

  it('gives a held stream a cut armed after it arrived', async () => {
    const llm = await started()
    llm.holdNextNarrative()
    const held = narrativeCall(llm)
    await vi.waitFor(() => expect(llm.requests).toHaveLength(1))

    llm.cutNextNarrative()
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
