import { describe, expect, it, beforeEach } from 'vitest'

import { storyDefinitionSchema, storySettingsSchema } from '@/lib/db'

import { currentStoryStore } from './current-story'

const definition = storyDefinitionSchema.parse({
  mode: 'adventure',
  leadEntityId: 'char_00000000-0000-4000-8000-000000000001',
  narration: 'first',
  genre: { label: 'Fantasy', promptBody: 'high fantasy' },
  tone: { label: 'Wry', promptBody: 'wry' },
  setting: 'A keep on a hill.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
})
const settings = storySettingsSchema.parse({
  classifierCadence: 8,
  piggybackMode: 'off',
  embeddingBackend: 'local',
  embedding_model_id: 'm',
  retrievalBudgets: { entities: 1, lore: 1, happenings: 1, threads: 1, chapters: 1 },
  composerModesEnabled: true,
  composerWrapPov: 'first',
  suggestionsEnabled: false,
  suggestionCategories: [],
  translation: {
    enabled: false,
    targetLanguage: null,
    granularToggles: {
      narrative: false,
      entityNames: false,
      entityDescriptions: false,
      lore: false,
      threads: false,
      happenings: false,
      chapterMeta: false,
    },
  },
  models: {},
  activePackId: 'pack_bundled_default',
  packVariables: {},
})

describe('currentStoryStore', () => {
  beforeEach(() => currentStoryStore.__reset())

  it('starts empty', () => {
    expect(currentStoryStore.getCurrentStory()).toBeNull()
  })

  it('set stores the parsed open story and clear/reset empties it', () => {
    currentStoryStore.set({ storyId: 's1', branchId: 'b1', definition, settings })
    expect(currentStoryStore.getCurrentStory()).toEqual({
      storyId: 's1',
      branchId: 'b1',
      definition,
      settings,
    })
    currentStoryStore.clear()
    expect(currentStoryStore.getCurrentStory()).toBeNull()
  })
})
