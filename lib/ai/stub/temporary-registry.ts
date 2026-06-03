import { setHttpCallKnownSecretValues } from '@/lib/diagnostics'

import type { ProviderInstance } from '../types'

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

const STUB_PROVIDER_ID = 'stub'

// Dev-only seam: real provider settings land in a later milestone, so the smoke
// scaffolding self-registers a stub here. Idempotent so repeat clicks / fast
// refresh don't duplicate it.
export function registerStubProvider(): string {
  if (!providers.some((provider) => provider.id === STUB_PROVIDER_ID)) {
    providers = [
      ...providers,
      {
        id: STUB_PROVIDER_ID,
        type: 'stub',
        displayName: 'Smoke stub',
        apiKey: 'stub-key',
        favoriteModelIds: [],
      },
    ]
    syncProviderSecrets()
  }
  return STUB_PROVIDER_ID
}
