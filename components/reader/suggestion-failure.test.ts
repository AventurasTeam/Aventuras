import { describe, expect, it } from 'vitest'

import { describeContextWindow } from '@/lib/ai'
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

  // A cut suggestion reply is refused, not repaired, so the strip says which limit cut it.
  describe('a cut-off reply', () => {
    const cut = {
      kind: 'reply-cut-off',
      target: 'suggestion',
      cause: 'max-output',
      outputTokens: 1030,
      reasoningTokens: null,
      maxOutput: 1024,
      window: null,
      providerId: 'prov_local',
      modelId: 'qwen3-32b',
    } satisfies PipelineError
    const UNKNOWN =
      "The server stopped the suggestion model's reply at its own limit. Setting a max output on the suggestion profile overrides it."

    it("names the suggestion profile's max output", () => {
      expect(describeSuggestionFailure(cut)).toBe(
        "The suggestion model's reply was cut off at the suggestion profile's 1,024-token max output. Raise it, then Retry.",
      )
    })

    it("names the model's window when the window was the limit", () => {
      expect(
        describeSuggestionFailure({ ...cut, cause: 'window', maxOutput: null, window: 65536 }),
      ).toBe(
        "The suggestion model's reply was cut off where the prompt and reply filled the model's 65,536-token window.",
      )
    })

    it("points at the server's own limit when the call sent no max output", () => {
      expect(describeSuggestionFailure({ ...cut, cause: 'unknown', maxOutput: null })).toBe(UNKNOWN)
      expect(describeSuggestionFailure({ ...cut, maxOutput: null })).toBe(UNKNOWN)
    })

    it('names the max output the server stopped short of', () => {
      expect(describeSuggestionFailure({ ...cut, cause: 'unknown', outputTokens: 300 })).toBe(
        "The server stopped the suggestion model's reply at its own limit, short of the suggestion profile's 1,024-token max output.",
      )
    })
  })
})

describe('describeSuggestionFailure for a prompt over the context window', () => {
  const LLAMACPP_MESSAGE =
    'request (71834 tokens) exceeds the available context size (65536 tokens), try increasing it'

  const refused = {
    kind: 'context-window',
    target: 'suggestion',
    detectedBy: 'check',
    estimate: 71_234,
    window: 65_536,
    windowSource: 'configured',
    providerId: 'prov_local',
    modelId: 'llama3.1:70b',
  } satisfies PipelineError

  const rejected = {
    ...refused,
    detectedBy: 'provider',
    window: null,
    windowSource: 'unknown',
    detail: LLAMACPP_MESSAGE,
  } satisfies PipelineError

  const REMEDIES =
    'Shorten the history buffer in Story Settings, raise the window if the model allows more, or switch the suggestion model to one with a larger window.'
  const providerCopy = (message: string) =>
    `The provider rejected the suggestion prompt. Its message suggests it exceeded the model's context window: “${message}”. ${REMEDIES}`

  it("names the rounded estimate and the model's window with its source", () => {
    expect(describeSuggestionFailure(refused)).toBe(
      `The suggestion prompt is about 71,300 tokens, over llama3.1:70b's 65,536-token context window (set by you). Nothing was sent. ${REMEDIES}`,
    )
  })

  it('names a detected window as detected', () => {
    expect(describeSuggestionFailure({ ...refused, windowSource: 'detected' })).toBe(
      `The suggestion prompt is about 71,300 tokens, over llama3.1:70b's 65,536-token context window (detected). Nothing was sent. ${REMEDIES}`,
    )
  })

  it("quotes the provider's message, hedged, when the provider rejected the prompt", () => {
    expect(describeSuggestionFailure(rejected)).toBe(providerCopy(LLAMACPP_MESSAGE))
  })

  it('keeps the provider copy when the window was known as well', () => {
    expect(
      describeSuggestionFailure({ ...rejected, window: 65_536, windowSource: 'detected' }),
    ).toBe(providerCopy(LLAMACPP_MESSAGE))
  })

  it('quotes the diagnostic line when the provider gave no message', () => {
    const { detail: _detail, ...unquoted } = rejected
    expect(describeSuggestionFailure(unquoted)).toBe(providerCopy(describeContextWindow(unquoted)))
  })

  it('quotes the diagnostic line when the provider message is only whitespace', () => {
    const { detail: _detail, ...unquoted } = rejected
    expect(describeSuggestionFailure({ ...rejected, detail: ' \n\t ' })).toBe(
      providerCopy(describeContextWindow(unquoted)),
    )
  })

  it('falls back to the generic body for a check failure with no window to print', () => {
    expect(describeSuggestionFailure({ ...refused, window: null, windowSource: 'unknown' })).toBe(
      t('reader:suggestions.errorBody'),
    )
    expect(hasCopy('reader:suggestions.errorBody')).toBe(true)
  })
})
