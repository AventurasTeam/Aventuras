import { createAnthropic, type AnthropicProvider } from '@ai-sdk/anthropic'
import type { LanguageModel } from 'ai'

import { createFetchWithCapture } from './fetch'
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
        }),
      })

      return anthropic(modelId as AnthropicModelId)
    }
    default:
      throw new Error(`Provider type "${provider.type}" is not supported in Slice 1.4`)
  }
}
