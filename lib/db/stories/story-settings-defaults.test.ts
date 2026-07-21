import { describe, expect, it } from 'vitest'

import { storySettingsSchema } from './story-config-schema'
import { STORY_SETTINGS_DEFAULTS, buildStorySettings } from './story-settings-defaults'

describe('STORY_SETTINGS_DEFAULTS', () => {
  it('is a complete, parseable StorySettings', () => {
    expect(() => storySettingsSchema.parse(STORY_SETTINGS_DEFAULTS)).not.toThrow()
  })
  it('has all M2-inert features off', () => {
    expect(STORY_SETTINGS_DEFAULTS.translation.enabled).toBe(false)
    expect(STORY_SETTINGS_DEFAULTS.suggestionsEnabled).toBe(false)
    expect(STORY_SETTINGS_DEFAULTS.composerModesEnabled).toBe(false)
    expect(STORY_SETTINGS_DEFAULTS.models).toEqual({})
  })
})

describe('buildStorySettings', () => {
  it('produces a complete settings from an empty app default', () => {
    const s = buildStorySettings({}, null, null)
    expect(s.embedding_model_id).toBe('Xenova/all-MiniLM-L6-v2')
    expect(s.retrievalBudgets.entities).toBe(8)
  })
  it('lets the app embedding model id win', () => {
    expect(buildStorySettings({}, 'text-embedding-3-small', null).embedding_model_id).toBe(
      'text-embedding-3-small',
    )
  })
  it('lets the app default partial override base fields', () => {
    expect(
      buildStorySettings({ chapterTokenThreshold: 9999 }, null, null).chapterTokenThreshold,
    ).toBe(9999)
  })

  it('captures the app provider id so a provider-backend story stays resolvable', () => {
    const s = buildStorySettings(
      { embeddingBackend: 'provider' },
      'text-embedding-3-small',
      'prov-1',
    )
    expect(s.embedding_provider_id).toBe('prov-1')
  })

  it('omits the provider id when the app has none', () => {
    expect(buildStorySettings({}, null, null).embedding_provider_id).toBeUndefined()
  })

  it('does not let a stale app-default model id outrank the app selection', () => {
    const s = buildStorySettings({ embedding_model_id: 'stale/model' }, 'fresh/model', null)
    expect(s.embedding_model_id).toBe('fresh/model')
  })
})
