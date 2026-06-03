import { createAnthropic, type AnthropicProvider } from '@ai-sdk/anthropic'
import type { LanguageModel } from 'ai'

import { getCurrentActionId } from '@/lib/diagnostics'

import { makeScenarioFetch, type StubScenario } from './stub/scenarios'
import { createFetchWithCapture } from './transport/fetch'
import type { ProviderInstance } from './types'

type AnthropicModelId = Parameters<AnthropicProvider>[0]

export function createProviderModel(provider: ProviderInstance, modelId: string): LanguageModel {
  switch (provider.type) {
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: provider.apiKey,
        ...(provider.endpoint !== undefined ? { baseURL: provider.endpoint } : {}),
        fetch: createFetchWithCapture({
          source: `provider:${provider.id}`,
          getActionId: getCurrentActionId,
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
          getActionId: getCurrentActionId,
          fetchImpl: makeScenarioFetch(modelId as StubScenario),
        }),
      })

      return anthropic('claude-3-haiku-20240307')
    }
    default:
      throw new Error(`Provider type "${provider.type}" is not supported in Slice 1.4`)
  }
}
