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
    const s = buildStorySettings({}, null)
    expect(s.embedding_model_id).toBe('bge-small-en')
    expect(s.retrievalBudgets.entities).toBe(8)
  })
  it('lets the app embedding model id win', () => {
    expect(buildStorySettings({}, 'text-embedding-3-small').embedding_model_id).toBe(
      'text-embedding-3-small',
    )
  })
  it('lets the app default partial override base fields', () => {
    expect(buildStorySettings({ chapterTokenThreshold: 9999 }, null).chapterTokenThreshold).toBe(
      9999,
    )
  })
})
