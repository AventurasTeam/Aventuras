import { createAnthropic, type AnthropicProvider } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

import { makeScenarioFetch, type StubScenario } from './stub/scenarios'
import { createFetchWithCapture } from './transport/fetch'
import { type ProviderInstanceWithStub } from './types'

type AnthropicModelId = Parameters<AnthropicProvider>[0]

export function createProviderModel(
  provider: ProviderInstanceWithStub,
  modelId: string,
  actionId?: string,
): LanguageModel {
  switch (provider.type) {
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: provider.apiKey,
        ...(provider.endpoint !== undefined ? { baseURL: provider.endpoint } : {}),
        fetch: createFetchWithCapture({
          source: `provider:${provider.id}`,
          actionId,
        }),
      })

      return anthropic(modelId as AnthropicModelId)
    }
    case 'stub': {
      if (typeof __DEV__ !== 'undefined' && !__DEV__) {
        throw new Error("Provider type 'stub' is not available in production builds")
      }
      const anthropic = createAnthropic({
        apiKey: provider.apiKey || 'stub-key',
        fetch: createFetchWithCapture({
          source: `provider:${provider.id}`,
          actionId,
          fetchImpl: makeScenarioFetch(modelId as StubScenario),
        }),
      })

      return anthropic('claude-3-haiku-20240307')
    }
    case 'openai-compatible': {
      const endpoint = provider.endpoint?.trim()
      if (endpoint === undefined || endpoint.length === 0) {
        throw new Error(`Provider "${provider.id}" (openai-compatible) requires an endpoint`)
      }
      const openaiCompatible = createOpenAICompatible({
        name: provider.displayName,
        apiKey: provider.apiKey,
        baseURL: endpoint,
        fetch: createFetchWithCapture({
          source: `provider:${provider.id}`,
          actionId,
        }),
      })

      return openaiCompatible(modelId)
    }
    default:
      throw new Error(`Provider type "${provider.type}" is not supported in Slice 1.4`)
  }
}
