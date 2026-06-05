import { describe, expect, it } from 'vitest'

import {
  appSettingsConfigSchema,
  modelProfileSchema,
  providerInstanceSchema,
} from './app-settings-schema'

const MINIMAL_EXISTING = {
  providers: [],
  profiles: [],
  assignments: {},
  defaultProviderId: null,
}

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

  it('accepts a temperature above 1 (provider ranges up to 2)', () => {
    expect(modelProfileSchema.safeParse({ ...VALID_PROFILE, temperature: 1.5 }).success).toBe(true)
  })

  it('rejects a temperature outside 0-2', () => {
    expect(modelProfileSchema.safeParse({ ...VALID_PROFILE, temperature: 2.5 }).success).toBe(false)
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
    expect('id' in parsed).toBe(false)
    expect('diagnostics' in parsed).toBe(false)
    expect(parsed.providers).toEqual([])
    expect(parsed.profiles).toEqual([])
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

describe('appSettingsConfigSchema — new fields (Task 4)', () => {
  it('applies defaults for newly-added config fields when they are absent', () => {
    const parsed = appSettingsConfigSchema.parse(MINIMAL_EXISTING)
    expect(parsed.appearance.density).toBe('default')
    expect(parsed.appearance.themeId).toBeTypeOf('string')
    expect(parsed.uiLanguage).toBeTypeOf('string')
    expect(parsed.defaultSuggestionCategories).toEqual({ adventure: [], creative: [] })
    expect(parsed.defaultStorySettings).toEqual({})
    expect(parsed.onboardingCompletedAt).toBeNull()
    expect(parsed.defaultCalendarId).toBeNull()
    expect(parsed.embeddingModelId).toBeNull()
    expect(parsed.embeddingProviderId).toBeNull()
  })

  it('fills appearance field-level defaults for a partial appearance', () => {
    const parsed = appSettingsConfigSchema.parse({
      ...MINIMAL_EXISTING,
      appearance: { themeId: 'dark' },
    })
    expect(parsed.appearance.themeId).toBe('dark')
    expect(parsed.appearance.density).toBe('default')
    expect(parsed.appearance.readerFontScale).toBe(1)
  })

  it('preserves explicit values when supplied', () => {
    const parsed = appSettingsConfigSchema.parse({
      ...MINIMAL_EXISTING,
      uiLanguage: 'fr',
      onboardingCompletedAt: 1700000000000,
      defaultCalendarId: 'cal-gregorian',
      embeddingModelId: 'text-embedding-3-small',
      embeddingProviderId: 'prov-openai',
      appearance: {
        themeId: 'dark',
        readerFontScale: 1.2,
        density: 'compact',
      },
      defaultSuggestionCategories: {
        adventure: [
          { id: 'c1', label: 'Action', promptHint: 'act', color: '#f00', enabled: true, order: 0 },
        ],
        creative: [],
      },
    })
    expect(parsed.uiLanguage).toBe('fr')
    expect(parsed.onboardingCompletedAt).toBe(1700000000000)
    expect(parsed.defaultCalendarId).toBe('cal-gregorian')
    expect(parsed.embeddingModelId).toBe('text-embedding-3-small')
    expect(parsed.embeddingProviderId).toBe('prov-openai')
    expect(parsed.appearance.density).toBe('compact')
    expect(parsed.appearance.themeId).toBe('dark')
    expect(parsed.defaultSuggestionCategories.adventure).toHaveLength(1)
  })

  it('accepts a partial defaultStorySettings (proving .partial() is wired)', () => {
    const parsed = appSettingsConfigSchema.parse({
      ...MINIMAL_EXISTING,
      defaultStorySettings: { chapterAutoClose: false },
    })
    expect(parsed.defaultStorySettings.chapterAutoClose).toBe(false)
  })

  it('rejects a defaultStorySettings with an invalid field type', () => {
    const result = appSettingsConfigSchema.safeParse({
      ...MINIMAL_EXISTING,
      defaultStorySettings: { chapterAutoClose: 'yes' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid density value in appearance', () => {
    const result = appSettingsConfigSchema.safeParse({
      ...MINIMAL_EXISTING,
      appearance: { themeId: 't', readerFontScale: 1, density: 'jumbo' },
    })
    expect(result.success).toBe(false)
  })

  it('strips non-config columns (id, diagnostics, createdAt, updatedAt) from a full row', () => {
    const parsed = appSettingsConfigSchema.parse({
      id: 'singleton',
      diagnostics: { enabled: true, debug_level_enabled: false },
      createdAt: 1700000000000,
      updatedAt: 1700000000001,
      ...MINIMAL_EXISTING,
    })
    expect('id' in parsed).toBe(false)
    expect('diagnostics' in parsed).toBe(false)
    expect('createdAt' in parsed).toBe(false)
    expect('updatedAt' in parsed).toBe(false)
  })
})
