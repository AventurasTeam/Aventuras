import type { LanguageModel } from 'ai'

import { createProviderModel } from './providers'
import { findTemporaryProvider } from './stub/temporary-registry'

export function getModel(providerId: string, modelId: string): LanguageModel {
  const provider = findTemporaryProvider(providerId)

  if (provider === undefined) {
    throw new Error(`Provider "${providerId}" is not configured`)
  }

  return createProviderModel(provider, modelId)
}
