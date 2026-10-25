import { generateText } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { createProviderModel } from './providers'
import type { ProviderInstanceWithStub } from './types'

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
})
