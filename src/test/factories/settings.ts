import type { GenerationPreset, APIProfile } from '$lib/types'

export function buildPresetConfig(overrides: Partial<GenerationPreset> = {}): GenerationPreset {
  return {
    id: crypto.randomUUID(),
    name: 'Test Preset',
    description: null,
    profileId: null,
    model: 'gpt-4o-mini',
    temperature: 0.7,
    maxTokens: 1024,
    reasoningEffort: 'off',
    manualBody: '',
    ...overrides,
  }
}

export function buildApiProfile(overrides: Partial<APIProfile> = {}): APIProfile {
  return {
    id: crypto.randomUUID(),
    name: 'Test Profile',
    providerType: 'openai',
    apiKey: 'test-api-key',
    customModels: [],
    fetchedModels: [],
    hiddenModels: [],
    favoriteModels: [],
    createdAt: Date.now(),
    ...overrides,
  }
}
