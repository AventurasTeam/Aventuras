import type { LanguageModel } from 'ai'

import { appSettingsStore } from '@/lib/stores'

import { createProviderModel } from './providers'
import { findTestProvider } from './stub/test-provider-registry'
import type { ProviderInstanceWithStub } from './types'

function findConfiguredProvider(providerId: string): ProviderInstanceWithStub | undefined {
  return appSettingsStore.getAppSettings().providers.find((p) => p.id === providerId)
}

export function getModel(providerId: string, modelId: string, actionId?: string): LanguageModel {
  // Real configured providers resolve here; findTestProvider is the
  // test-only injection seam (setTestProviders) and is empty in prod.
  const provider = findConfiguredProvider(providerId) ?? findTestProvider(providerId)

  if (provider === undefined) {
    throw new Error(`Provider "${providerId}" is not configured`)
  }

  return createProviderModel(provider, modelId, actionId)
}
