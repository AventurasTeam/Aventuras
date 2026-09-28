import { describe, it, expect } from 'vitest'
import type { StorySettings } from '$lib/types'
import { IMAGE_GENERATION_MODES, readStorySettings } from './storySettings'

// Settings as an older version, or a hand-edited export, may have stored them.
const legacy = (settings: object) => settings as StorySettings

describe('readStorySettings', () => {
  it.each(IMAGE_GENERATION_MODES)('keeps a saved %s', (mode) => {
    expect(readStorySettings({ imageGenerationMode: mode, tone: 'wry' })).toEqual({
      imageGenerationMode: mode,
      tone: 'wry',
    })
  })

  it.each([
    ['the old agentic value', legacy({ imageGenerationMode: 'auto' })],
    ['an unknown string', legacy({ imageGenerationMode: 'sometimes' })],
    ['a non-string', legacy({ imageGenerationMode: 1 })],
    ['null', legacy({ imageGenerationMode: null })],
  ])('drops %s, leaving no mode chosen', (_, settings) => {
    const read = readStorySettings({ ...settings, tone: 'wry' })
    expect(read).toEqual({ tone: 'wry' })
    expect(read).not.toHaveProperty('imageGenerationMode')
  })

  it('leaves settings without a mode, and the old inline flag, as they are', () => {
    expect(readStorySettings(legacy({ inlineImageMode: true }))).toEqual({ inlineImageMode: true })
  })

  it('passes null through', () => {
    expect(readStorySettings(null)).toBeNull()
  })
})
