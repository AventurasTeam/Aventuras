import { setHttpCallKnownSecretValues } from '@/lib/diagnostics'
import { appSettingsStore } from '@/lib/stores'

import type { ProviderInstanceWithStub } from '../types'

let providers: ProviderInstanceWithStub[] = []

function syncProviderSecrets(): void {
  const configuredKeys = appSettingsStore.getAppSettings().providers.map((p) => p.apiKey)
  const stubKeys = providers.map((provider) => provider.apiKey)
  setHttpCallKnownSecretValues([...configuredKeys, ...stubKeys])
}

export function findTestProvider(providerId: string): ProviderInstanceWithStub | undefined {
  return providers.find((provider) => provider.id === providerId)
}

export function setTestProviders(nextProviders: ProviderInstanceWithStub[]): void {
  providers = [...nextProviders]
  syncProviderSecrets()
}

export function resetTestProviders(): void {
  providers = []
  syncProviderSecrets()
}
