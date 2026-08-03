import { describe, it, expect, vi } from 'vitest'

vi.mock('$lib/stores/debug.svelte', () => ({
  debug: {
    addDebugRequest: vi.fn(),
    addDebugResponse: vi.fn(),
  },
}))

vi.mock('$lib/stores/settings.svelte', () => ({
  settings: {
    apiSettings: {
      mainNarrativeProfileId: 'p1',
      defaultModel: 'test-model',
      profiles: [],
    },
    generationPresets: [],
  },
}))

import { isPingEligible, shouldShowHealthFor } from './modelHealthOrchestrator'
import type { APIProfile } from '$lib/types'

describe('modelHealthOrchestrator', () => {
  it('checks profile ping eligibility correctly', () => {
    expect(isPingEligible(null)).toBe(false)

    const openrouterProfile: APIProfile = {
      id: 'p1',
      name: 'OpenRouter',
      providerType: 'openrouter',
      apiKey: 'sk-or-test',
      pingEnabled: true,
      fetchedModels: [],
      customModels: [],
    } as any

    expect(isPingEligible(openrouterProfile)).toBe(true)

    const disabledProfile: APIProfile = {
      ...openrouterProfile,
      pingEnabled: false,
    }
    expect(isPingEligible(disabledProfile)).toBe(false)
  })

  it('determines whether to show health badge for openrouter free models only', () => {
    const openrouterProfile: APIProfile = { providerType: 'openrouter' } as any
    expect(shouldShowHealthFor(openrouterProfile, 'meta-llama/llama-3.3-70b-instruct:free')).toBe(
      true,
    )
    expect(shouldShowHealthFor(openrouterProfile, 'anthropic/claude-3.5-sonnet')).toBe(false)

    const nvidiaProfile: APIProfile = { providerType: 'nvidia-nim' } as any
    expect(shouldShowHealthFor(nvidiaProfile, 'meta/llama-3.1-405b-instruct')).toBe(true)
  })
})
