import { setHttpCallKnownSecretValues } from '@/lib/diagnostics'

import type { ProviderInstance } from './types'

let providers: ProviderInstance[] = []

function syncProviderSecrets(): void {
  setHttpCallKnownSecretValues(providers.map((provider) => provider.apiKey))
}

export function findTemporaryProvider(providerId: string): ProviderInstance | undefined {
  return providers.find((provider) => provider.id === providerId)
}

export function setTemporaryProvidersForTests(nextProviders: ProviderInstance[]): void {
  providers = [...nextProviders]
  syncProviderSecrets()
}

export function resetTemporaryProvidersForTests(): void {
  providers = []
  syncProviderSecrets()
}
