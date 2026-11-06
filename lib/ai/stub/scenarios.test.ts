import { describe, expect, it } from 'vitest'

import {
  makeScenarioFetch,
  STUB_THINKING_SIGNATURE,
  STUB_TOOL_INPUT,
  STUB_TOOL_NAME,
} from './scenarios'

type StubMessage = { content: Record<string, unknown>[]; stop_reason: string }

const USER_TURN = { role: 'user', content: [{ type: 'text', text: 'Open the door.' }] }
const SIGNED_THINKING = {
  type: 'thinking',
  thinking: 'Look before acting.',
  signature: STUB_THINKING_SIGNATURE,
}
const TOOL_USE = {
  type: 'tool_use',
  id: 'toolu_stub_1',
  name: STUB_TOOL_NAME,
  input: STUB_TOOL_INPUT,
}
const TOOL_RESULT = {
  role: 'user',
  content: [{ type: 'tool_result', tool_use_id: 'toolu_stub_1', content: 'A heavy oak door.' }],
}

/** An Anthropic request body: the user turn, then whatever follows it. */
function sent(...after: unknown[]): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-3-haiku-20240307', messages: [USER_TURN, ...after] }),
  }
}

async function payloadText(res: Response): Promise<string> {
  const body = (await res.json()) as { content: { text: string }[] }
  return body.content[0].text
}

describe('makeScenarioFetch', () => {
  it('happy returns a parseable reply payload', async () => {
    const res = await makeScenarioFetch('happy')('https://stub.test')
    expect(res.status).toBe(200)
    expect(JSON.parse(await payloadText(res))).toEqual({ reply: 'hi' })
  })

  it('malformed-json returns an unparseable text payload', async () => {
    const res = await makeScenarioFetch('malformed-json')('https://stub.test')
    const text = await payloadText(res)
    expect(() => JSON.parse(text)).toThrow()
  })

  it('refusal returns a refusal-flagged payload', async () => {
    const res = await makeScenarioFetch('refusal')('https://stub.test')
    expect(JSON.parse(await payloadText(res))).toEqual({ refusal: true })
  })

  it('cancellation-respects rejects when the request signal aborts', async () => {
    const ctrl = new AbortController()
    const promise = makeScenarioFetch('cancellation-respects')('https://stub.test', {
      signal: ctrl.signal,
    })
    ctrl.abort()
    await expect(promise).rejects.toThrow()
  })

  it('mid-stream-timeout rejects immediately with a timeout error', async () => {
    await expect(makeScenarioFetch('mid-stream-timeout')('https://stub.test')).rejects.toThrow()
  })

  it('tool-step opens a conversation with a signed thinking block and a tool_use', async () => {
    const res = await makeScenarioFetch('tool-step')('https://stub.test', sent())

    expect(res.status).toBe(200)
    expect((await res.json()) as StubMessage).toMatchObject({
      content: [SIGNED_THINKING, TOOL_USE],
      stop_reason: 'tool_use',
    })
  })

  it('tool-step answers text once a tool_result follows the signed thinking block', async () => {
    const res = await makeScenarioFetch('tool-step')(
      'https://stub.test',
      sent({ role: 'assistant', content: [SIGNED_THINKING, TOOL_USE] }, TOOL_RESULT),
    )

    expect(res.status).toBe(200)
    expect((await res.json()) as StubMessage).toMatchObject({
      content: [{ type: 'text', text: 'The door opens.' }],
      stop_reason: 'end_turn',
    })
  })

  it.each([
    ['without the thinking block', [TOOL_USE]],
    ['with another signature', [{ ...SIGNED_THINKING, signature: 'forged' }, TOOL_USE]],
  ])('tool-step refuses a tool_result whose call came back %s', async (_label, content) => {
    const res = await makeScenarioFetch('tool-step')(
      'https://stub.test',
      sent({ role: 'assistant', content }, TOOL_RESULT),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      type: 'error',
      error: { type: 'invalid_request_error', message: expect.stringContaining('thinking block') },
    })
  })

  it('tool-step-cut stops on max_tokens partway through its text', async () => {
    const res = await makeScenarioFetch('tool-step-cut')('https://stub.test', sent())

    expect((await res.json()) as StubMessage).toMatchObject({
      content: [{ type: 'text', text: 'The door' }],
      stop_reason: 'max_tokens',
    })
  })

  it('throws on an unknown scenario (bad cast guard)', async () => {
    await expect(
      makeScenarioFetch('bogus' as Parameters<typeof makeScenarioFetch>[0])('https://stub.test'),
    ).rejects.toThrow('Unknown stub scenario')
  })
})
