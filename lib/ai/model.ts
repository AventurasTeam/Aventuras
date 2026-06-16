import type { LanguageModel } from 'ai'

import { appSettingsStore } from '@/lib/stores'

import { createProviderModel } from './providers'
import { findTemporaryProvider } from './stub/temporary-registry'
import type { ProviderInstanceWithStub } from './types'

function findConfiguredProvider(providerId: string): ProviderInstanceWithStub | undefined {
  return appSettingsStore.getAppSettings().providers.find((p) => p.id === providerId)
}

export function getModel(providerId: string, modelId: string, actionId?: string): LanguageModel {
  // Real configured providers win; the temporary stub registry stays a fallback
  // until Slice 2.7 removes the smoke seam.
  const provider = findConfiguredProvider(providerId) ?? findTemporaryProvider(providerId)

  if (provider === undefined) {
    throw new Error(`Provider "${providerId}" is not configured`)
  }

  return createProviderModel(provider, modelId, actionId)
}
