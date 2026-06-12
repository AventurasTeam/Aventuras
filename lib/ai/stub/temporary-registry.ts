import { setHttpCallKnownSecretValues } from '@/lib/diagnostics'
import { appSettingsStore } from '@/lib/stores'

import type { ProviderInstanceWithStub } from '../types'

let providers: ProviderInstanceWithStub[] = []

// setHttpCallKnownSecretValues replaces the whole comparator, and app_settings
// hydrate is the other writer — so union the configured keys in here (the stub
// side owns the merge because app_settings can't import this dev seam) to keep
// registering the stub from dropping a real provider's key.
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
