import { describe, expect, it } from 'vitest'
import type { ReasoningEffort } from '$lib/types'
import {
  clampReasoningToCapability,
  ENFORCED_REASONING_FLOOR,
  isReasoningOn,
  REASONING_LABELS,
  REASONING_LEVELS,
  reasoningCapabilityFor,
  reasoningIsEnforced,
  type ReasoningCapability,
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

  it('starts at none, so the slider index and the level agree', () => {
    expect(REASONING_LEVELS[0]).toBe('none')
  })

  it('never spells the disabled level "off"', () => {
    // The pre-0.7.x spelling. It survives only in settingsMigrations, reading old installs.
    expect(REASONING_LEVELS).not.toContain('off')
    expect(Object.values(REASONING_LABELS)).not.toContain('Off')
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

  it('treats an unknown model as supported when there is no catalogue to consult', () => {
    // Otherwise every provider without capability fetching loses the slider entirely.
    expect(
      reasoningCapabilityFor({
        ...base,
        providerType: 'llamacpp',
        providerFetchesModelCapabilities: false,
        modelSupportsReasoning: undefined,
      }),
    ).toBe('supported')
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
    for (const level of levels) {
      expect(clampReasoningToCapability(level, 'supported'), level).toBe(level)
    }
  })

  it('lets a supported model be turned off', () => {
    // The whole point of the fix.
    expect(clampReasoningToCapability('none', 'supported')).toBe('none')
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

  it('is idempotent, since it runs on every render', () => {
    const capabilities: ReasoningCapability[] = ['enforced', 'supported', 'unsupported']
    for (const capability of capabilities) {
      for (const level of levels) {
        const once = clampReasoningToCapability(level, capability)
        expect(clampReasoningToCapability(once, capability), `${capability}/${level}`).toBe(once)
      }
    }
  })
})

describe('the reasoning effort type', () => {
  it('covers exactly the levels the AI SDK names, minus provider-default', () => {
    // Keeping these aligned is why 'off' was renamed to 'none' in the first place.
    const sdkLevels: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
    expect([...REASONING_LEVELS]).toEqual(sdkLevels)
  })
})
