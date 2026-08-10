import { describe, it, expect, vi } from 'vitest'

vi.mock('$lib/stores/settings.svelte', () => ({
  settings: {
    advancedRequestSettings: {
      manualMode: false,
    },
  },
}))

vi.mock('$lib/stores/debug.svelte', () => ({
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
import { PROVIDERS, usesThinkTag } from './providers/config'
import type { GenerationPreset } from '$lib/types'

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

  it('names the reasoning option the way @ai-sdk/openai-compatible reads it', () => {
    const resultNone = buildProviderOptions(
      { ...basePreset, reasoningEffort: 'none' },
      'openai-compatible',
    )
    expect(resultNone).toEqual({
      openaiCompatible: {
        reasoningEffort: 'none',
      },
    })

    const resultHigh = buildProviderOptions(
      { ...basePreset, reasoningEffort: 'high' },
      'openai-compatible',
    )
    expect(resultHigh).toEqual({
      openaiCompatible: {
        reasoningEffort: 'high',
      },
    })
  })

  it('uses the same key for every provider built by createOpenAICompatible', () => {
    for (const provider of [
      'llamacpp',
      'lmstudio',
      'ollama',
      'nanogpt',
      'chutes',
      'nvidia-nim',
    ] as const) {
      const result = buildProviderOptions({ ...basePreset, reasoningEffort: 'low' }, provider)
      const options = Object.values(result ?? {})[0] as Record<string, unknown>

      expect(options, `${provider} sent no reasoning option`).toHaveProperty(
        'reasoningEffort',
        'low',
      )
      expect(options, `${provider} still sends the snake_case key`).not.toHaveProperty(
        'reasoning_effort',
      )
    }
  })

  it('sends Zhipu the camelCase key alongside its own thinking switch', () => {
    // Zhipu is `createOpenAICompatible` too, but has a second, provider-specific key, so
    // it is the one branch the loop above cannot cover.
    expect(buildProviderOptions({ ...basePreset, reasoningEffort: 'high' }, 'zhipu')).toEqual({
      zhipu: {
        thinking: { type: 'enabled' },
        reasoningEffort: 'high',
      },
    })
  })

  it('turns Zhipu thinking off for "none" rather than asking for none of it', () => {
    // The effort key is dropped here on purpose: `thinking: disabled` is what suppresses
    // it, and sending both says two things about one setting.
    expect(buildProviderOptions({ ...basePreset, reasoningEffort: 'none' }, 'zhipu')).toEqual({
      zhipu: {
        thinking: { type: 'disabled' },
      },
    })
  })

  it('carries "none" through rather than omitting it', () => {
    // `none` is what suppresses thinking, so omitting it is not equivalent to sending it.
    const result = buildProviderOptions({ ...basePreset, reasoningEffort: 'none' }, 'llamacpp')
    expect(result).toEqual({ llamacpp: { reasoningEffort: 'none' } })
  })

  it('looks up hyphenated providers under the camelCase key the SDK prefers', () => {
    expect(buildProviderOptions({ ...basePreset, reasoningEffort: 'low' }, 'nvidia-nim')).toEqual({
      nvidiaNim: { reasoningEffort: 'low' },
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
    // llama.cpp publishes no catalogue, so the per-model flag is meaningless there.
    expect(resolveStructuredOutputs(preset('auto'), 'llamacpp', undefined)).toBe(
      PROVIDERS.llamacpp.capabilities.structuredOutput,
    )
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
