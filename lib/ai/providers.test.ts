import { describe, expect, it } from 'vitest'

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
