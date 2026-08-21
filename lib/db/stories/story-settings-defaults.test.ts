import { describe, expect, it } from 'vitest'

import { DEFAULT_SUGGESTION_CATEGORIES } from './default-suggestion-categories'
import { storySettingsSchema, type SuggestionCategory } from './story-config-schema'
import { STORY_SETTINGS_DEFAULTS, buildStorySettings } from './story-settings-defaults'

type BuildStorySettingsApp = Parameters<typeof buildStorySettings>[1]

function app(over: Partial<BuildStorySettingsApp> = {}): BuildStorySettingsApp {
  return {
    defaultStorySettings: {},
    embeddingModelId: null,
    embeddingProviderId: null,
    defaultSuggestionCategories: {
      adventure: [...DEFAULT_SUGGESTION_CATEGORIES.adventure],
      creative: [...DEFAULT_SUGGESTION_CATEGORIES.creative],
    },
    ...over,
  }
}

describe('STORY_SETTINGS_DEFAULTS', () => {
  it('is a complete, parseable StorySettings', () => {
    expect(() => storySettingsSchema.parse(STORY_SETTINGS_DEFAULTS)).not.toThrow()
  })
  it('has all M2-inert features off', () => {
    expect(STORY_SETTINGS_DEFAULTS.translation.enabled).toBe(false)
    expect(STORY_SETTINGS_DEFAULTS.composerModesEnabled).toBe(false)
    expect(STORY_SETTINGS_DEFAULTS.models).toEqual({})
  })
})

describe('buildStorySettings', () => {
  it('produces a complete settings from an empty app default', () => {
    const s = buildStorySettings('adventure', app())
    expect(s.embedding_model_id).toBe('Xenova/all-MiniLM-L6-v2')
    expect(s.retrievalBudgets.entities).toBe(1200)
  })
  // `undefined` has no bindable SQL form: a present-but-undefined key throws on write.
  it('emits no key that is present but undefined', () => {
    const undefinedKeys = (s: object) =>
      Object.entries(s)
        .filter(([, value]) => value === undefined)
        .map(([key]) => key)
    expect(undefinedKeys(buildStorySettings('adventure', app()))).toEqual([])
    expect(
      undefinedKeys(buildStorySettings('creative', app({ embeddingProviderId: 'p1' }))),
    ).toEqual([])
  })
  it('lets the app embedding model id win', () => {
    expect(
      buildStorySettings('adventure', app({ embeddingModelId: 'text-embedding-3-small' }))
        .embedding_model_id,
    ).toBe('text-embedding-3-small')
  })
  it('lets the app default partial override base fields', () => {
    expect(
      buildStorySettings(
        'adventure',
        app({ defaultStorySettings: { chapterTokenThreshold: 9999 } }),
      ).chapterTokenThreshold,
    ).toBe(9999)
  })

  it('captures the app provider id so a provider-backend story stays resolvable', () => {
    const s = buildStorySettings(
      'adventure',
      app({
        defaultStorySettings: { embeddingBackend: 'provider' },
        embeddingModelId: 'text-embedding-3-small',
        embeddingProviderId: 'prov-1',
      }),
    )
    expect(s.embedding_provider_id).toBe('prov-1')
  })

  it('omits the provider id when the app has none', () => {
    expect(buildStorySettings('adventure', app()).embedding_provider_id).toBeUndefined()
  })

  it('does not let a stale app-default model id outrank the app selection', () => {
    const s = buildStorySettings(
      'adventure',
      app({
        defaultStorySettings: { embedding_model_id: 'stale/model' },
        embeddingModelId: 'fresh/model',
      }),
    )
    expect(s.embedding_model_id).toBe('fresh/model')
  })

  it('does not let a stale app-default provider id survive an empty app selection', () => {
    const s = buildStorySettings(
      'adventure',
      app({
        defaultStorySettings: { embedding_provider_id: 'stale-prov' },
        embeddingModelId: 'fresh/model',
      }),
    )
    expect(s.embedding_provider_id).toBeUndefined()
  })

  it('does not let a stale app-default provider id outrank the app selection', () => {
    const s = buildStorySettings(
      'adventure',
      app({
        defaultStorySettings: { embedding_provider_id: 'stale-prov' },
        embeddingModelId: 'fresh/model',
        embeddingProviderId: 'prov-1',
      }),
    )
    expect(s.embedding_provider_id).toBe('prov-1')
  })

  it('stores a positive effectiveDim from the 3rd param', () => {
    expect(buildStorySettings('adventure', app(), 1024).effectiveDim).toBe(1024)
  })

  it('omits effectiveDim when null (native dim) so the field stays absent', () => {
    expect(buildStorySettings('adventure', app(), null).effectiveDim).toBeUndefined()
    expect(buildStorySettings('adventure', app()).effectiveDim).toBeUndefined()
  })
})

describe('buildStorySettings — suggestion palette', () => {
  it('seeds from the app-level per-mode palette', () => {
    const custom: SuggestionCategory[] = [
      { id: 'x', label: 'Custom', promptHint: 'h', color: 'blue', enabled: true, order: 0 },
    ]
    const settings = buildStorySettings(
      'adventure',
      app({ defaultSuggestionCategories: { adventure: custom, creative: [] } }),
    )
    expect(settings.suggestionCategories).toEqual(custom)
  })

  it('falls back to the constant when the app palette for that mode is empty', () => {
    const settings = buildStorySettings(
      'adventure',
      app({ defaultSuggestionCategories: { adventure: [], creative: [] } }),
    )
    expect(settings.suggestionCategories.map((c) => c.label)).toEqual([
      'Action',
      'Dialogue',
      'Examine',
      'Move',
    ])
  })

  it('picks the palette matching the story mode', () => {
    expect(buildStorySettings('creative', app()).suggestionCategories.map((c) => c.label)).toEqual([
      'Action',
      'Dialogue',
      'Revelation',
      'Twist',
    ])
  })

  it('enables suggestions by default', () => {
    expect(buildStorySettings('adventure', app()).suggestionsEnabled).toBe(true)
  })
})
