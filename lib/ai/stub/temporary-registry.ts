import { setHttpCallKnownSecretValues } from '@/lib/diagnostics'
import { appSettingsStore } from '@/lib/stores'

import type { ProviderInstanceWithStub } from '../types'

let providers: ProviderInstanceWithStub[] = []

function syncProviderSecrets(): void {
  const configuredKeys = appSettingsStore.getAppSettings().providers.map((p) => p.apiKey)
  const stubKeys = providers.map((provider) => provider.apiKey)
  setHttpCallKnownSecretValues([...configuredKeys, ...stubKeys])
}

export function findTemporaryProvider(providerId: string): ProviderInstanceWithStub | undefined {
  return providers.find((provider) => provider.id === providerId)
}

export function setTemporaryProvidersForTests(nextProviders: ProviderInstanceWithStub[]): void {
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
