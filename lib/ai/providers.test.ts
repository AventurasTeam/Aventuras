import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText, streamText } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { createProviderModel } from './providers'
import type { ProviderInstanceWithStub } from './types'

// A spy that still builds the real provider: a malformed endpoint never reaches fetch, so the
// header can only be read off the options the provider was built with.
vi.mock('@ai-sdk/anthropic', async (orig) => {
  const actual = await orig<{ createAnthropic: typeof createAnthropic }>()
  return { ...actual, createAnthropic: vi.fn(actual.createAnthropic) }
})

const oai: ProviderInstanceWithStub = {
  id: 'prov-1',
  type: 'openai-compatible',
  displayName: 'Local',
  apiKey: 'sk-local',
  endpoint: 'http://localhost:1234/v1',
  favoriteModelIds: [],
}

describe('createProviderModel · openai-compatible', () => {
  it('builds a language model for an openai-compatible provider', () => {
    const model = createProviderModel(oai, 'my-model', 'action-1')
    expect(model).toBeDefined()
  })

  it('still throws for an unsupported provider type', () => {
    const google = { ...oai, type: 'google' as const }
    expect(() => createProviderModel(google, 'm')).toThrow()
  })
})

const CHUNK = { id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 0, model: 'my-model' }

function eventStream(frames: readonly unknown[]): Response {
  const body = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')
  return new Response(`${body}data: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

// architecture.md → Truncation cross-check: without stream_options most servers report no usage
// on a stream, so the cross-check and the prompt total would read nothing.
describe('createProviderModel · openai-compatible streams', () => {
  it('asks for usage on a streamed call and reads the prompt count it gets back', async () => {
    const bodies: { stream?: boolean; stream_options?: { include_usage?: boolean } }[] = []
    vi.stubGlobal('fetch', async (request: Request) => {
      const body = (await request.json()) as (typeof bodies)[number]
      bodies.push(body)
      return eventStream([
        {
          ...CHUNK,
          choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }],
        },
        { ...CHUNK, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
        // As a server does: the usage chunk only when the request asked for it.
        ...(body.stream_options?.include_usage === true
          ? [
              {
                ...CHUNK,
                choices: [],
                usage: { prompt_tokens: 42, completion_tokens: 1, total_tokens: 43 },
              },
            ]
          : []),
      ])
    })
    try {
      const result = streamText({
        model: createProviderModel(oai, 'my-model'),
        prompt: 'hi',
        maxRetries: 0,
      })
      await result.consumeStream()
      expect(bodies).toHaveLength(1)
      expect(bodies[0]).toMatchObject({ stream: true, stream_options: { include_usage: true } })
      expect((await result.usage).inputTokens).toBe(42)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('createProviderModel · anthropic', () => {
  const anthropic: ProviderInstanceWithStub = {
    id: 'prov-a',
    type: 'anthropic',
    displayName: 'Anthropic',
    apiKey: 'sk-ant',
    favoriteModelIds: [],
  }

  async function sentHeaders(provider: ProviderInstanceWithStub): Promise<Headers> {
    const requests: Request[] = []
    vi.stubGlobal('fetch', async (request: Request) => {
      requests.push(request)
      return Response.json({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-test',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      })
    })
    try {
      await generateText({
        model: createProviderModel(provider, 'claude-test'),
        prompt: 'hi',
        maxRetries: 0,
      })
    } finally {
      vi.unstubAllGlobals()
    }
    expect(requests).toHaveLength(1)
    return requests[0].headers
  }

  // The desktop renderer is a browser origin, and Anthropic refuses its preflight without it.
  it.each([
    ['no endpoint', undefined],
    ["Anthropic's own endpoint", 'https://api.anthropic.com/v1'],
  ])('sends the browser-access header with %s', async (_case, endpoint) => {
    const headers = await sentHeaders({ ...anthropic, ...(endpoint ? { endpoint } : {}) })
    expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe('true')
  })

  // A proxy answers its own CORS, and one listing its allowed headers would refuse this one.
  it('leaves the header off for a proxy endpoint', async () => {
    const headers = await sentHeaders({ ...anthropic, endpoint: 'https://proxy.example.com/v1' })
    expect(headers.get('anthropic-dangerous-direct-browser-access')).toBeNull()
  })

  // An endpoint that isn't a URL can't be Anthropic's own.
  it('leaves the header off for a malformed endpoint', () => {
    vi.mocked(createAnthropic).mockClear()
    createProviderModel({ ...anthropic, endpoint: 'api.anthropic.com/v1' }, 'claude-test')
    expect(createAnthropic).toHaveBeenCalledOnce()
    expect(vi.mocked(createAnthropic).mock.calls[0]?.[0]).not.toHaveProperty('headers')
  })
})
