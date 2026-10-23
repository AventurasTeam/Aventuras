import { describe, expect, it } from 'vitest'
import type { ReasoningEffort } from '#lib/types/index.ts'
import {
  clampReasoningToCapability,
  ENFORCED_REASONING_FLOOR,
  isReasoningEffort,
  isReasoningOn,
  REASONING_LABELS,
  REASONING_LEVELS,
  reasoningCapabilityFor,
  reasoningIsEnforced,
} from './reasoning'

describe('isReasoningOn', () => {
  it('is off for none and for a missing value', () => {
    expect(isReasoningOn('none')).toBe(false)
    expect(isReasoningOn(undefined)).toBe(false)
  })

  it('is on for every other level', () => {
    for (const level of REASONING_LEVELS.filter((l) => l !== 'none')) {
      expect(isReasoningOn(level), level).toBe(true)
    }
  })
})

describe('REASONING_LEVELS', () => {
  it('has a label for every level and a level for every label', () => {
    expect(Object.keys(REASONING_LABELS).sort()).toEqual([...REASONING_LEVELS].sort())
  })

  it('lists the levels in slider order, starting at none', () => {
    // The type already ties the set to the AI SDK's; this pins the order. The slider index is the
    // level's index, so 'none' has to be first.
    const ascending: ReasoningEffort[] = [
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]
    expect([...REASONING_LEVELS]).toEqual(ascending)
  })

  it('never labels the disabled level "Off"', () => {
    expect(Object.values(REASONING_LABELS)).not.toContain('Off')
  })
})

describe('isReasoningEffort', () => {
  it('accepts every current level', () => {
    for (const level of REASONING_LEVELS) {
      expect(isReasoningEffort(level), level).toBe(true)
    }
  })

  it('rejects anything else', () => {
    for (const value of ['off', 'ultra', '', null, undefined, 3]) {
      expect(isReasoningEffort(value), String(value)).toBe(false)
    }
  })
})

describe('reasoningIsEnforced', () => {
  it('matches NanoGPT thinking variants on either separator', () => {
    expect(reasoningIsEnforced('nanogpt', 'zai-org/glm-5:thinking')).toBe(true)
    expect(reasoningIsEnforced('nanogpt', 'some/model-thinking')).toBe(true)
    expect(reasoningIsEnforced('nanogpt', 'zai-org/glm-5:thinking:high')).toBe(true)
  })

  it('does not match a model that merely supports reasoning', () => {
    expect(reasoningIsEnforced('nanogpt', 'deepseek/deepseek-v3.2')).toBe(false)
    // The regression: 'thinking' has to be a suffix, not a substring.
    expect(reasoningIsEnforced('nanogpt', 'vendor/thinking-machine-v2')).toBe(false)
  })

  it('is NanoGPT-only, since the suffix is their naming convention', () => {
    expect(reasoningIsEnforced('openrouter', 'zai-org/glm-5:thinking')).toBe(false)
  })
})

describe('reasoningCapabilityFor', () => {
  const base = {
    providerType: 'nanogpt' as const,
    modelId: 'deepseek/deepseek-v3.2',
    providerSupportsReasoning: true,
    providerFetchesModelCapabilities: true,
    modelSupportsReasoning: true,
  }

  it('is unsupported without a model', () => {
    expect(reasoningCapabilityFor({ ...base, modelId: '' })).toBe('unsupported')
  })

  it('is unsupported when the provider does no reasoning', () => {
    expect(reasoningCapabilityFor({ ...base, providerSupportsReasoning: false })).toBe(
      'unsupported',
    )
  })

  it('trusts a catalogue that says the model cannot reason', () => {
    expect(reasoningCapabilityFor({ ...base, modelSupportsReasoning: false })).toBe('unsupported')
  })

  it('treats the flag as a guess when there is no catalogue to consult', () => {
    // Otherwise every provider without capability fetching loses the slider entirely.
    expect(
      reasoningCapabilityFor({
        ...base,
        providerType: 'llamacpp',
        providerFetchesModelCapabilities: false,
        modelSupportsReasoning: false,
      }),
    ).toBe('supported')
  })

  it('treats an unknown model as supported when the catalogue omits the flag', () => {
    // A capability-fetching provider whose entry for this model has no reasoning flag at all --
    // distinct from an explicit false, which stays unsupported.
    expect(reasoningCapabilityFor({ ...base, modelSupportsReasoning: undefined })).toBe('supported')
  })

  it('enforces only the thinking variants', () => {
    expect(reasoningCapabilityFor({ ...base, modelId: 'zai-org/glm-5:thinking' })).toBe('enforced')
  })

  it('leaves an ordinary NanoGPT reasoning model merely supported', () => {
    // This is the #412 regression: the UI said 'supported' while the store forced 'high'.
    expect(reasoningCapabilityFor(base)).toBe('supported')
  })
})

describe('clampReasoningToCapability', () => {
  const levels = REASONING_LEVELS

  it('drops everything to none when reasoning is unsupported', () => {
    for (const level of levels) {
      expect(clampReasoningToCapability(level, 'unsupported'), level).toBe('none')
    }
  })

  it('leaves every level untouched when reasoning is merely supported', () => {
    // Including 'none': a supported model can be turned off, which is the whole point of the fix.
    for (const level of levels) {
      expect(clampReasoningToCapability(level, 'supported'), level).toBe(level)
    }
  })

  it('lifts an enforced model off none, and touches nothing else', () => {
    expect(clampReasoningToCapability('none', 'enforced')).toBe(ENFORCED_REASONING_FLOOR)
    for (const level of levels.filter((l) => l !== 'none')) {
      expect(clampReasoningToCapability(level, 'enforced'), level).toBe(level)
    }
  })

  it('lands an enforced model on a level the slider can actually show', () => {
    // The enforced slider starts at index 1, so the floor must not be 'none'.
    expect(levels.indexOf(ENFORCED_REASONING_FLOOR)).toBeGreaterThan(0)
  })
})
