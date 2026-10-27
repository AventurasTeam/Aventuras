import type { ProviderCapabilities, ProviderInstance } from '../db'

export type ModelCapabilities = ProviderCapabilities

export function resolveModelCapabilities(
  providerId: string,
  modelId: string,
  providers: readonly ProviderInstance[],
): ModelCapabilities | undefined {
  const provider = providers.find((p) => p.id === providerId)
  const cached = provider?.cachedModels?.find((m) => m.id === modelId)
  return cached?.capabilities
}
