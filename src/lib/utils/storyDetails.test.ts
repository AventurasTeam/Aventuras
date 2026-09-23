import { describe, it, expect } from 'vitest'
import { storyDetailsUpdate } from './storyDetails'
import type { Story, StoryDetails } from '$lib/types'

const story = (overrides: Partial<Story> = {}): Story =>
  ({
    id: 'story-1',
    title: 'The Hollow Crown',
    description: 'A kingdom without an heir.',
    genre: 'Fantasy',
    mode: 'adventure',
    settings: { pov: 'second', tense: 'present', customSystemPrompt: 'keep me' },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }) as Story

const details = (overrides: Partial<StoryDetails> = {}): StoryDetails => ({
  title: 'The Hollow Crown',
  genre: 'Fantasy',
  description: 'A kingdom without an heir.',
  genreColor: null,
  ...overrides,
})

describe('storyDetailsUpdate', () => {
  it('writes nothing when nothing changed', () => {
    expect(storyDetailsUpdate(story(), details())).toBeNull()
  })

  it('ignores surrounding whitespace, which the save trims anyway', () => {
    expect(storyDetailsUpdate(story(), details({ title: '  The Hollow Crown  ' }))).toBeNull()
  })

  it('refuses a blank title', () => {
    expect(storyDetailsUpdate(story(), details({ title: '   ' }))).toBeNull()
  })

  it('sends only the changed columns', () => {
    expect(storyDetailsUpdate(story(), details({ title: 'The Hollow Throne' }))).toEqual({
      title: 'The Hollow Throne',
    })
  })

  it('clears a blank genre and description', () => {
    expect(storyDetailsUpdate(story(), details({ genre: '', description: '   ' }))).toEqual({
      genre: null,
      description: null,
    })
  })

  it('keeps the rest of the settings when the genre colour changes', () => {
    const updates = storyDetailsUpdate(story(), details({ genreColor: 'teal' }))

    expect(updates?.settings).toEqual({
      pov: 'second',
      tense: 'present',
      customSystemPrompt: 'keep me',
      genreColor: 'teal',
    })
  })

  it('drops the key when the colour goes back to default', () => {
    const stored = story({ settings: { pov: 'second', genreColor: 'teal' } })

    expect(storyDetailsUpdate(stored, details({ genreColor: null }))?.settings).toEqual({
      pov: 'second',
    })
  })

  it('carries the settings over for a story that has none', () => {
    const stored = story({ settings: null })

    expect(storyDetailsUpdate(stored, details({ genreColor: 'pink' }))?.settings).toEqual({
      genreColor: 'pink',
    })
  })
})
