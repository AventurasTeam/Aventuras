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

import { buildProviderOptions } from './generate'
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
