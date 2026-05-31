import { describe, expect, it } from 'vitest'

import {
  appSettingsConfigSchema,
  modelProfileSchema,
  providerInstanceSchema,
} from './app-settings-schema'

const VALID_PROVIDER = {
  id: 'p1',
  type: 'anthropic',
  displayName: 'Anthropic (work)',
  apiKey: 'sk-x',
  favoriteModelIds: ['claude-opus-4'],
}

const VALID_PROFILE = {
  id: 'prof1',
  kind: 'narrative',
  name: 'Narrative',
  modelRef: { providerId: 'p1', modelId: 'claude-opus-4' },
}

describe('providerInstanceSchema', () => {
  it('accepts a minimal valid provider', () => {
    expect(providerInstanceSchema.safeParse(VALID_PROVIDER).success).toBe(true)
  })

  it('accepts a fully-populated provider with cached models', () => {
    const ok = providerInstanceSchema.safeParse({
      ...VALID_PROVIDER,
      endpoint: 'https://example.test',
      cachedModels: [{ id: 'm1', capabilities: { reasoning: true, matryoshkaDims: [256, 512] } }],
      customModelIds: ['custom-1'],
      cachedAt: 1234,
    })
    expect(ok.success).toBe(true)
  })

  it('rejects a provider missing apiKey', () => {
    const { apiKey: _omit, ...noKey } = VALID_PROVIDER
    expect(providerInstanceSchema.safeParse(noKey).success).toBe(false)
  })

  it('rejects an unknown provider type', () => {
    expect(providerInstanceSchema.safeParse({ ...VALID_PROVIDER, type: 'mystery' }).success).toBe(
      false,
    )
  })
})

describe('modelProfileSchema', () => {
  it('accepts a minimal narrative profile', () => {
    expect(modelProfileSchema.safeParse(VALID_PROFILE).success).toBe(true)
  })

  it('rejects an unknown kind', () => {
    expect(modelProfileSchema.safeParse({ ...VALID_PROFILE, kind: 'wizard' }).success).toBe(false)
  })

  it('rejects a temperature outside 0-1', () => {
    expect(modelProfileSchema.safeParse({ ...VALID_PROFILE, temperature: 1.5 }).success).toBe(false)
  })
})

describe('appSettingsConfigSchema', () => {
  it('accepts an empty config (fresh-install defaults)', () => {
    const ok = appSettingsConfigSchema.safeParse({
      providers: [],
      profiles: [],
      assignments: {},
      defaultProviderId: null,
    })
    expect(ok.success).toBe(true)
  })

  it('accepts a populated config', () => {
    const ok = appSettingsConfigSchema.safeParse({
      providers: [VALID_PROVIDER],
      profiles: [VALID_PROFILE],
      assignments: { classifier: 'prof1' },
      defaultProviderId: 'p1',
    })
    expect(ok.success).toBe(true)
  })

  it('strips non-config columns (id, diagnostics) from a full row', () => {
    const parsed = appSettingsConfigSchema.parse({
      id: 'singleton',
      diagnostics: { enabled: true, debug_level_enabled: false },
      providers: [],
      profiles: [],
      assignments: {},
      defaultProviderId: null,
    })
    expect(parsed).toEqual({
      providers: [],
      profiles: [],
      assignments: {},
      defaultProviderId: null,
    })
  })

  it('rejects a non-array providers field', () => {
    const bad = appSettingsConfigSchema.safeParse({
      providers: 'nope',
      profiles: [],
      assignments: {},
      defaultProviderId: null,
    })
    expect(bad.success).toBe(false)
  })

  it('rejects a structurally-invalid provider element', () => {
    const bad = appSettingsConfigSchema.safeParse({
      providers: [{ id: 'p1' }],
      profiles: [],
      assignments: {},
      defaultProviderId: null,
    })
    expect(bad.success).toBe(false)
  })
})
