import { describe, expect, it } from 'vitest'

import type { ProviderInstance } from '../db'
import { resolveModelCapabilities } from './model-capabilities'

describe('resolveModelCapabilities', () => {
  const mockProviders: ProviderInstance[] = [
    {
      id: 'prov-1',
      type: 'anthropic',
      displayName: 'Anthropic',
      apiKey: 'key-1',
      favoriteModelIds: [],
      cachedModels: [
        {
          id: 'claude-3-5-sonnet',
          capabilities: {
            reasoning: true,
            structuredOutput: true,
            taggedBlockReliable: true,
          },
        },
        {
          id: 'claude-3-haiku',
          capabilities: {
            taggedBlockReliable: false,
          },
        },
        {
          id: 'claude-no-caps',
        },
      ],
    },
    {
      id: 'prov-2',
      type: 'openai',
      displayName: 'OpenAI',
      apiKey: 'key-2',
      favoriteModelIds: [],
    },
  ]

  it('returns capabilities when provider and model match and capabilities exist', () => {
    const caps = resolveModelCapabilities('prov-1', 'claude-3-5-sonnet', mockProviders)
    expect(caps).toEqual({
      reasoning: true,
      structuredOutput: true,
      taggedBlockReliable: true,
    })
  })

  it('returns capabilities when taggedBlockReliable is false', () => {
    const caps = resolveModelCapabilities('prov-1', 'claude-3-haiku', mockProviders)
    expect(caps).toEqual({
      taggedBlockReliable: false,
    })
  })

  it('returns undefined when model has no capabilities', () => {
    const caps = resolveModelCapabilities('prov-1', 'claude-no-caps', mockProviders)
    expect(caps).toBeUndefined()
  })

  it('returns undefined when modelId is not found in provider cachedModels', () => {
    const caps = resolveModelCapabilities('prov-1', 'unknown-model', mockProviders)
    expect(caps).toBeUndefined()
  })

  it('returns undefined when providerId is not found', () => {
    const caps = resolveModelCapabilities('unknown-prov', 'claude-3-5-sonnet', mockProviders)
    expect(caps).toBeUndefined()
  })

  it('returns undefined when provider has no cachedModels', () => {
    const caps = resolveModelCapabilities('prov-2', 'gpt-4o', mockProviders)
    expect(caps).toBeUndefined()
  })
})
