import { describe, it, expect, vi } from 'vitest'

vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: {
    advancedRequestSettings: {
      manualMode: false,
    },
  },
}))

vi.mock('#lib/stores/debug.svelte.ts', () => ({
  debugStore: {
    logApiRequest: vi.fn(),
    logApiResponse: vi.fn(),
  },
}))

import {
  buildProviderOptions,
  resolveStructuredOutputs,
  thinkingNudgeApplies,
} from './presetResolution'
import { usesThinkTag } from './providers/config'
import type { GenerationPreset } from '#lib/types/index.ts'

describe('buildProviderOptions', () => {
  const basePreset: GenerationPreset = {
    id: 'test-preset',
    name: 'Test Preset',
    description: 'Test description',
    profileId: 'test-profile',
    manualBody: '',
    model: 'Gemma 4 31B',
    temperature: 0.7,
    maxTokens: 1000,
    reasoningEffort: 'none',
  }

  it('hands OpenRouter its effort in the reasoning object, which it reads instead of the SDK option', () => {
    for (const reasoningEffort of ['none', 'high'] as const) {
      expect(buildProviderOptions({ ...basePreset, reasoningEffort }, 'openrouter')).toEqual({
        openrouter: { reasoning: { effort: reasoningEffort } },
      })
    }
  })

  it('sends Zhipu its own thinking switch, leaving the effort to the SDK option', () => {
    expect(buildProviderOptions({ ...basePreset, reasoningEffort: 'high' }, 'zhipu')).toEqual({
      zhipu: { thinking: { type: 'enabled' } },
    })
    expect(buildProviderOptions({ ...basePreset, reasoningEffort: 'none' }, 'zhipu')).toEqual({
      zhipu: { thinking: { type: 'disabled' } },
    })
  })

  it('keeps snake_case for Pollinations, which is not an openai-compatible provider', () => {
    // `ai-sdk-pollinations` declares `reasoning_effort` in its own settings interface.
    expect(
      buildProviderOptions({ ...basePreset, reasoningEffort: 'medium' }, 'pollinations'),
    ).toEqual({ pollinations: { reasoning_effort: 'medium', parallel_tool_calls: true } })
  })
})

describe('resolveStructuredOutputs', () => {
  const preset = (override?: 'auto' | 'on' | 'off'): GenerationPreset => ({
    id: 'p',
    name: 'p',
    description: '',
    profileId: 'x',
    manualBody: '',
    model: 'm',
    temperature: 0.7,
    maxTokens: 1000,
    reasoningEffort: 'none',
    structuredOutputOverride: override,
  })

  it('honours an explicit override whatever the catalogue says', () => {
    expect(resolveStructuredOutputs(preset('on'), 'nanogpt', false)).toBe(true)
    expect(resolveStructuredOutputs(preset('off'), 'nanogpt', true)).toBe(false)
  })

  it('trusts the per-model flag where the provider publishes one', () => {
    expect(resolveStructuredOutputs(preset('auto'), 'nanogpt', true)).toBe(true)
    expect(resolveStructuredOutputs(preset('auto'), 'nanogpt', false)).toBe(false)
  })

  it('falls back to the provider default where it does not', () => {
    // llama.cpp publishes no catalogue, so the per-model flag is meaningless there. The
    // expected value is written out rather than read back from PROVIDERS, which would make
    // the assertion agree with whatever the config says and test nothing.
    expect(resolveStructuredOutputs(preset('auto'), 'llamacpp', undefined)).toBe(true)
    expect(resolveStructuredOutputs(preset('auto'), 'llamacpp', false)).toBe(true)
  })

  it('treats a missing override as auto, which is what an older preset has stored', () => {
    expect(resolveStructuredOutputs(preset(undefined), 'nanogpt', true)).toBe(true)
  })
})

describe('thinkingNudgeApplies', () => {
  const base = {
    providerType: 'llamacpp' as const,
    reasoningEffort: 'high' as const,
    supportsStructuredOutput: false,
  }

  it('needs a think-tag provider', () => {
    expect(thinkingNudgeApplies(base)).toBe(true)
    expect(thinkingNudgeApplies({ ...base, providerType: 'anthropic' })).toBe(false)
  })

  it('needs reasoning to be on', () => {
    expect(thinkingNudgeApplies({ ...base, reasoningEffort: 'none' })).toBe(false)
    expect(thinkingNudgeApplies({ ...base, reasoningEffort: undefined })).toBe(false)
  })

  it('needs the schema to travel in the prompt, which native structured output replaces', () => {
    expect(thinkingNudgeApplies({ ...base, supportsStructuredOutput: true })).toBe(false)
  })

  it('covers the generic openai-compatible provider, whose model is unknown', () => {
    expect(thinkingNudgeApplies({ ...base, providerType: 'openai-compatible' })).toBe(true)
  })
})

describe('usesThinkTag', () => {
  it('is one expression for a condition that used to be written four times', () => {
    // The fourth, in generateNarrative, omitted the openai-compatible half entirely.
    expect(usesThinkTag('openai-compatible')).toBe(true)
    expect(usesThinkTag('anthropic')).toBe(false)
  })
})
