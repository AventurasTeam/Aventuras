import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { story } from '$lib/stores/story/index.svelte'
import { ContextBuilder } from './context-builder'

vi.mock('$lib/services/database', () => ({
  database: {
    getStoryPackId: vi.fn().mockResolvedValue('test-pack'),
    getPackVariables: vi.fn().mockResolvedValue([]),
    getStoryCustomVariables: vi.fn().mockResolvedValue(null),
    getRuntimeVariables: vi.fn().mockResolvedValue([]),
    // DB path methods — should NOT be called when singleton is populated
    getStory: vi.fn().mockResolvedValue(null),
    getCharacters: vi.fn().mockResolvedValue([]),
    getLocations: vi.fn().mockResolvedValue([]),
    getItems: vi.fn().mockResolvedValue([]),
    getStoryBeats: vi.fn().mockResolvedValue([]),
    getPackTemplate: vi.fn().mockResolvedValue(null),
  },
}))

vi.mock('$lib/services/templates/engine', () => ({
  templateEngine: { render: vi.fn().mockReturnValue('') },
}))

const TEST_STORY_ID = 'story-singleton-test'

beforeEach(() => {
  story.currentStory = {
    id: TEST_STORY_ID,
    mode: 'adventure',
    genre: 'fantasy',
    description: 'A test setting',
    settings: {
      pov: 'second',
      tense: 'past',
      tone: 'dark',
      themes: ['magic', 'betrayal'],
      visualProseMode: false,
      imageGenerationMode: 'standard',
    },
    timeTracker: { years: 1, days: 5, hours: 14, minutes: 30 },
  } as any

  // pov, tense, storyMode are readonly getters on the real class
  // but writable plain properties on the stores-stub.
  ;(story.generationContext as any).pov = 'second'
  ;(story.generationContext as any).tense = 'past'
  ;(story.generationContext as any).storyMode = 'adventure'

  story.character.characters = [
    { id: 'char-1', name: 'Hero', relationship: 'self', description: 'The hero' } as any,
    { id: 'char-2', name: 'Ally', relationship: 'companion', description: 'A friend' } as any,
  ]
  ;(story.character as any).protagonist = story.character.characters[0]

  story.location.locations = [
    { id: 'loc-1', name: 'Castle', description: 'A grand castle', current: true } as any,
  ]
  ;(story.location as any).currentLocation = story.location.locations[0]

  story.item.items = []
  story.storyBeat.storyBeats = []
  ;(story.time as any).timeTracker = { years: 1, days: 5, hours: 14, minutes: 30 }
})

afterEach(() => {
  story.currentStory = null
  story.character.characters = []
  story.location.locations = []
  story.item.items = []
  story.storyBeat.storyBeats = []
  ;(story.character as any).protagonist = undefined
  ;(story.location as any).currentLocation = undefined
  ;(story.generationContext as any).pov = 'first'
  ;(story.generationContext as any).tense = 'present'
  ;(story.generationContext as any).storyMode = 'adventure'
  ;(story.time as any).timeTracker = null
  vi.clearAllMocks()
})

describe('ContextBuilder.forStory singleton auto-detection', () => {
  it('singleton path is used when storyContext.currentStory.id matches storyId', async () => {
    const { database } = await import('$lib/services/database')

    await ContextBuilder.forStory(TEST_STORY_ID)

    expect(database.getStory).not.toHaveBeenCalled()
    expect(database.getCharacters).not.toHaveBeenCalled()
    expect(database.getLocations).not.toHaveBeenCalled()
    expect(database.getItems).not.toHaveBeenCalled()
    expect(database.getStoryBeats).not.toHaveBeenCalled()
    expect(database.getStoryPackId).toHaveBeenCalledWith(TEST_STORY_ID)
  })

  it('throws when storyContext.currentStory.id does not match', async () => {
    await expect(ContextBuilder.forStory('different-story-id')).rejects.toThrow('story not loaded')
  })

  it('throws when storyContext.currentStory is null', async () => {
    story.currentStory = null

    await expect(ContextBuilder.forStory(TEST_STORY_ID)).rejects.toThrow('story not loaded')
  })

  it('singleton path populates story settings correctly', async () => {
    const builder = await ContextBuilder.forStory(TEST_STORY_ID)
    const ctx = builder.getContext()

    expect(ctx.mode).toBe('adventure')
    expect(ctx.pov).toBe('second')
    expect(ctx.tense).toBe('past')
    expect(ctx.genre).toBe('fantasy')
    expect(ctx.tone).toBe('dark')
    expect(ctx.themes).toBe('magic, betrayal')
    expect(ctx.settingDescription).toBe('A test setting')
  })

  it('singleton path populates protagonist and location', async () => {
    const builder = await ContextBuilder.forStory(TEST_STORY_ID)
    const ctx = builder.getContext()

    expect(ctx.protagonistName).toBe('Hero')
    expect(ctx.protagonistDescription).toBe('The hero')
    expect(ctx.currentLocation).toBe('Castle')
    expect(ctx.currentLocationObject).toEqual({ name: 'Castle', description: 'A grand castle' })
  })

  it('singleton path populates storyTime', async () => {
    const builder = await ContextBuilder.forStory(TEST_STORY_ID)
    const ctx = builder.getContext()

    expect(ctx.storyTime).toBe('Year 2, Day 6, 14 hours 30 minutes')
  })
})
