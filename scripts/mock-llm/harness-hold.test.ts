import { describe, expect, it, vi } from 'vitest'

import { harnessPerTest, structuredCall } from './harness-calls'
import { EXAMPLES } from '../../e2e/harness/mock-llm'

// Set after the call arrived: an answer at arrival would carry the inert default, not this.
const PASS_REPLY = {
  happenings: [{ title: 'held', sourceTurn: 't1' }],
  relationships: [],
  statusFlips: [],
  newCharacters: [],
  newFactions: [],
  memberships: [],
}

async function replyOf(response: Promise<Response>): Promise<unknown> {
  const body = (await (await response).json()) as { choices: { message: { content: string } }[] }
  return JSON.parse(body.choices[0].message.content)
}

const started = harnessPerTest()

describe('startMockLlm — a held structured call', () => {
  it('records the call, then answers it at release with the reply set by then', async () => {
    const llm = await started()
    llm.holdNextStructured('periodic-classifier')
    const held = structuredCall(llm, 'periodic-classifier')
    await vi.waitFor(() =>
      expect(llm.requests.map((r) => r.agent)).toEqual(['periodic-classifier']),
    )
    llm.setStructured('periodic-classifier', PASS_REPLY)
    llm.releaseStructured()
    expect(await replyOf(held)).toEqual(PASS_REPLY)
  })

  it('holds one call: the next of that shape answers at once', async () => {
    const llm = await started()
    llm.holdNextStructured('periodic-classifier')
    const held = structuredCall(llm, 'periodic-classifier')
    await vi.waitFor(() => expect(llm.requests).toHaveLength(1))
    expect(await replyOf(structuredCall(llm, 'periodic-classifier'))).toEqual(
      EXAMPLES['periodic-classifier'],
    )
    llm.setStructured('periodic-classifier', PASS_REPLY)
    llm.releaseStructured()
    expect(await replyOf(held)).toEqual(PASS_REPLY)
  })

  it('lets another shape through and keeps the hold for its own', async () => {
    const llm = await started()
    llm.holdNextStructured('periodic-classifier')
    expect(await replyOf(structuredCall(llm, 'suggestion-refresh'))).toEqual(
      EXAMPLES['suggestion-refresh'],
    )
    const held = structuredCall(llm, 'periodic-classifier')
    await vi.waitFor(() => expect(llm.requests).toHaveLength(2))
    llm.setStructured('periodic-classifier', PASS_REPLY)
    llm.releaseStructured()
    expect(await replyOf(held)).toEqual(PASS_REPLY)
  })

  // An unanswered request keeps its connection open, and server.close() waits on it.
  it('answers a call still held when the server closes', async () => {
    const llm = await started()
    llm.holdNextStructured('periodic-classifier')
    const held = structuredCall(llm, 'periodic-classifier')
    await vi.waitFor(() => expect(llm.requests).toHaveLength(1))
    await llm.close()
    expect(await replyOf(held)).toEqual(EXAMPLES['periodic-classifier'])
  })
})

// Bounded, so a response left open fails its assertion instead of hanging the test.
function within<T>(promise: Promise<T>, ms = 2000): Promise<T | 'pending'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<'pending'>((resolve) => {
    timer = setTimeout(() => resolve('pending'), ms)
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

const statusOf = (response: Promise<Response>) => within(response.then((r) => r.status))

describe('startMockLlm — a structured reply JSON cannot hold', () => {
  it('fails a held call with a 400 and rethrows from close() while its client waits', async () => {
    const llm = await started()
    llm.setStructured('periodic-classifier', { n: 1n })
    llm.holdNextStructured('periodic-classifier')
    const held = structuredCall(llm, 'periodic-classifier')
    await vi.waitFor(() => expect(llm.requests).toHaveLength(1))

    await expect(within(llm.close())).rejects.toThrow('BigInt')

    expect(await statusOf(held)).toBe(400)
  })

  it('fails an unheld call with a 400 and keeps the throw for close()', async () => {
    const llm = await started()
    llm.setStructured('periodic-classifier', { n: 1n })

    expect(await statusOf(structuredCall(llm, 'periodic-classifier'))).toBe(400)

    await expect(within(llm.close())).rejects.toThrow('BigInt')
  })
})

describe('startMockLlm — a structured call no shape matches', () => {
  it('answers it at once with an empty object, with no hold armed', async () => {
    const llm = await started()
    const response = fetch(`${llm.url}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'mock', messages: [{ role: 'user', content: 'No block.' }] }),
    })
    expect(await within(replyOf(response))).toEqual({})
    expect(llm.requests.map((r) => r.agent)).toEqual([null])
  })
})

describe('startMockLlm — an unreadable request', () => {
  it('answers a body that is not JSON instead of leaving the client hanging', async () => {
    const llm = await started()
    const response = await fetch(`${llm.url}/chat/completions`, { method: 'POST', body: '{nope' })
    expect(response.status).toBe(400)
  })
})
