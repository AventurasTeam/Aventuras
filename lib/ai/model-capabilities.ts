import type { ProviderInstance } from '../db'

export type ModelCapabilities = {
  reasoning?: boolean
  structuredOutput?: boolean
  matryoshkaSupported?: boolean
  matryoshkaDims?: number[]
  taggedBlockReliable?: boolean
}

export function resolveModelCapabilities(
  providerId: string,
  modelId: string,
  providers: readonly ProviderInstance[],
): ModelCapabilities | undefined {
  const provider = providers.find((p) => p.id === providerId)
  const cached = provider?.cachedModels?.find((m) => m.id === modelId)
  return cached?.capabilities
}
