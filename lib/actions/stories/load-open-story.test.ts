import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  branches,
  entities,
  storyDefinitionSchema,
  storyEntries,
  storySettingsSchema,
  stories,
  type StoryDefinition,
  type StorySettings,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  currentStoryStore,
  entitiesStore,
  entriesStore,
  resetAllStores,
  storiesStore,
} from '@/lib/stores'

import { loadOpenStory } from './operational'

const STORY_DEFINITION = storyDefinitionSchema.parse({
  mode: 'adventure',
  leadEntityId: 'char_00000000-0000-4000-8000-000000000001',
  narration: 'first',
  genre: { label: 'Fantasy', promptBody: 'high fantasy' },
  tone: { label: 'Wry', promptBody: 'wry' },
  setting: 'A keep on a hill.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
})
const STORY_SETTINGS = storySettingsSchema.parse({
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

async function setup() {
  const { db, runInTransaction } = await createTestDb()
  resetAllStores()
  return { db, ctx: { db, runInTransaction } }
}

describe('loadOpenStory', () => {
  beforeEach(() => {
    resetAllStores()
  })

  it('parses config, hydrates entries + entities, and populates currentStoryStore', async () => {
    const { db, ctx } = await setup()
    await db.insert(stories).values({
      id: 'story_1',
      title: 'Aria',
      status: 'active',
      favorite: 0,
      createdAt: 1,
      updatedAt: 1,
      currentBranchId: 'br_1',
      definition: STORY_DEFINITION,
      settings: STORY_SETTINGS,
    })
    await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
    await db.insert(storyEntries).values({
      id: 'e_1',
      branchId: 'br_1',
      position: 1,
      kind: 'opening',
      content: 'The keep looms over the valley.',
      createdAt: 1,
    })
    await db.insert(entities).values({
      id: 'char_1',
      branchId: 'br_1',
      kind: 'character',
      name: 'Aria',
      status: 'active',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    })

    // Spy attached right before the call under test: the only selects it can
    // see are loadOpenStory's own reads — 1 branch/story join + 1 story_entries
    // + 1 entities. Anything beyond 3 would mean an extra (N+1-shaped) domain read.
    const selectSpy = vi.spyOn(ctx.db, 'select')

    const result = await loadOpenStory('br_1', ctx)

    expect(result).toEqual({ status: 'ok', storyId: 'story_1', branchId: 'br_1' })
    expect(selectSpy).toHaveBeenCalledTimes(3)

    const open = currentStoryStore.getCurrentStory()
    expect(open?.storyId).toBe('story_1')
    expect(open?.branchId).toBe('br_1')
    expect(open?.definition).toEqual(STORY_DEFINITION)
    expect(open?.settings).toEqual(STORY_SETTINGS)

    expect(entriesStore.getLoadedBranch()).toBe('br_1')
    expect([...entriesStore.getEntries().values()].map((e) => e.id)).toEqual(['e_1'])

    expect(entitiesStore.getLoadedBranch()).toBe('br_1')
    expect([...entitiesStore.getEntities().values()].map((e) => e.id)).toEqual(['char_1'])

    expect(storiesStore.getStories().openFailures.story_1).toBeUndefined()
  })

  it('badges the story and skips population when the definition fails to parse', async () => {
    const { db, ctx } = await setup()
    await db.insert(stories).values({
      id: 'story_bad',
      title: 'Broken',
      status: 'active',
      favorite: 0,
      createdAt: 1,
      updatedAt: 1,
      currentBranchId: 'br_bad',
      // Missing `mode` (and the rest of the required shape) — fails
      // storyDefinitionSchema.parse, simulating on-disk JSON corruption.
      definition: { leadEntityId: null } as unknown as StoryDefinition,
    })
    await db
      .insert(branches)
      .values({ id: 'br_bad', storyId: 'story_bad', name: 'main', createdAt: 1 })

    const result = await loadOpenStory('br_bad', ctx)

    expect(result).toEqual({ status: 'failed', kind: 'definition-corrupt' })
    expect(storiesStore.getStories().openFailures.story_bad).toBe('definition-corrupt')
    expect(currentStoryStore.getCurrentStory()).toBeNull()
    expect(entriesStore.getLoadedBranch()).toBeNull()
    expect(entitiesStore.getLoadedBranch()).toBeNull()
  })

  it('badges the story and skips population when the settings fail to parse', async () => {
    const { db, ctx } = await setup()
    await db.insert(stories).values({
      id: 'story_bad_settings',
      title: 'Broken settings',
      status: 'active',
      favorite: 0,
      createdAt: 1,
      updatedAt: 1,
      currentBranchId: 'br_bad_settings',
      definition: STORY_DEFINITION,
      // Valid definition, but settings omits every required field — fails
      // storySettingsSchema.parse while the definition parse succeeds.
      settings: {} as unknown as StorySettings,
    })
    await db.insert(branches).values({
      id: 'br_bad_settings',
      storyId: 'story_bad_settings',
      name: 'main',
      createdAt: 1,
    })

    const result = await loadOpenStory('br_bad_settings', ctx)

    expect(result).toEqual({ status: 'failed', kind: 'settings-corrupt' })
    expect(storiesStore.getStories().openFailures.story_bad_settings).toBe('settings-corrupt')
    expect(currentStoryStore.getCurrentStory()).toBeNull()
    expect(entriesStore.getLoadedBranch()).toBeNull()
    expect(entitiesStore.getLoadedBranch()).toBeNull()
  })

  it('returns no-story when the branch has no matching story', async () => {
    const { ctx } = await setup()
    const result = await loadOpenStory('br_missing', ctx)
    expect(result).toEqual({ status: 'no-story' })
  })
})
