import { describe, expect, it } from 'vitest'

import { t } from '@/lib/i18n'
import { hasCopy } from '@/lib/i18n/__tests__/locale-keys'
import { SUGGESTIONS_UNUSABLE, type PipelineError } from '@/lib/pipeline'

import { describeSuggestionFailure } from './suggestion-failure'

function resolverError(failure: string): PipelineError {
  return {
    kind: 'config-resolver',
    failure,
    target: 'suggestion',
    phaseName: 'suggestions',
  } as PipelineError
}

describe('describeSuggestionFailure', () => {
  it('names the suggestion agent for each app-chain failure', () => {
    expect(describeSuggestionFailure(resolverError('no-profile-assigned'))).toBe(
      t('reader:suggestions.failure.noProfileAssigned'),
    )
    expect(describeSuggestionFailure(resolverError('profile-missing'))).toBe(
      t('reader:suggestions.failure.profileMissing'),
    )
    expect(describeSuggestionFailure(resolverError('provider-missing'))).toBe(
      t('reader:suggestions.failure.providerMissing'),
    )
  })

  // Falling through to providerMissing here blames the app default for a fault
  // that lives on the story's own override.
  it('names the story override when the override provider is gone', () => {
    const key = 'reader:suggestions.failure.overrideProviderMissing'
    const copy = describeSuggestionFailure(resolverError('override-provider-missing'))

    expect(copy).toBe(t(key))
    // `t` echoes a missing key, which would make the line above pass vacuously.
    expect(hasCopy(key)).toBe(true)
    expect(copy).not.toBe(t('reader:suggestions.failure.providerMissing'))
  })

  it('keeps the unusable and provider arms distinct from the resolver ones', () => {
    expect(
      describeSuggestionFailure({
        kind: 'phase-logic',
        subsystem: SUGGESTIONS_UNUSABLE,
      } as PipelineError),
    ).toBe(t('reader:suggestions.failure.unusable'))
    expect(describeSuggestionFailure({ kind: 'provider', reason: 'auth' } as PipelineError)).toBe(
      t('reader:suggestions.failure.llmCall'),
    )
  })

  it('falls back to the generic strip body with no error', () => {
    expect(describeSuggestionFailure(undefined)).toBe(t('reader:suggestions.errorBody'))
    expect(describeSuggestionFailure(null)).toBe(t('reader:suggestions.errorBody'))
  })
})
