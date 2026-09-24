import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  branches,
  chapters,
  characterRelationships,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  lore,
  storyDefinitionSchema,
  storyEntries,
  storySettingsSchema,
  stories,
  threads,
  type StoryDefinition,
  type StorySettings,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  chaptersStore,
  characterRelationshipsStore,
  currentStoryStore,
  entitiesStore,
  entriesStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
  happeningsStore,
  loreStore,
  resetAllStores,
  storiesStore,
  threadsStore,
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
  classifierContextEntries: 4,
  piggybackMode: 'off',
  embeddingBackend: 'local',
  embedding_model_id: 'm',
  retrievalBudgets: { entities: 1, lore: 1, happenings: 1, threads: 1, chapters: 1 },
  keywordRetrieval: {
    mode: 'boost',
    budgetShare: 0.5,
    scanEntries: 1,
    cascade: false,
    cascadeMaxDepth: 2,
  },
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

  it('parses config, hydrates entries + entities + lore, and populates currentStoryStore', async () => {
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
    await db.insert(lore).values({
      id: 'lore_1',
      branchId: 'br_1',
      title: 'The Veil',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    })
    await db
      .insert(branches)
      .values({ id: 'br_2', storyId: 'story_1', name: 'branch-2', createdAt: 1 })
    await db.insert(lore).values({
      id: 'lore_2',
      branchId: 'br_2',
      title: 'Hidden Secrets',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    })
    await db.insert(threads).values({
      id: 'thread_1',
      branchId: 'br_1',
      title: 'Find the key',
      status: 'active',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    })
    await db.insert(happenings).values({
      id: 'hap_1',
      branchId: 'br_1',
      title: 'The gate falls',
      occurredAtEntryId: 'e_1',
      createdAt: 1,
      updatedAt: 1,
    })
    await db.insert(happeningInvolvements).values({
      id: 'hinv_1',
      branchId: 'br_1',
      happeningId: 'hap_1',
      entityId: 'char_1',
      role: 'witness',
    })
    await db.insert(happeningAwareness).values({
      id: 'haw_1',
      branchId: 'br_1',
      happeningId: 'hap_1',
      characterId: 'char_1',
      decayResistance: 0.5,
    })
    await db.insert(chapters).values({
      id: 'chap_1',
      branchId: 'br_1',
      sequenceNumber: 1,
      title: 'One',
      summary: 'The keep.',
      theme: 'arrival',
      keywords: [],
      startEntryId: 'e_1',
      endEntryId: 'e_1',
      tokenCount: 10,
      closedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    await db.insert(characterRelationships).values({
      id: 'rel_1',
      branchId: 'br_1',
      aId: 'char_1',
      bId: 'char_2',
      kind: 'ally',
      inverseKind: null,
      createdAt: 1,
      updatedAt: 1,
    })

    // Counts only loadOpenStory's own reads: join + entries + entities + lore + threads +
    // happenings + involvements + awareness + chapters + relationships = 10; more would mean an N+1 read.
    const selectSpy = vi.spyOn(ctx.db, 'select')

    const result = await loadOpenStory('br_1', ctx)

    expect(result).toEqual({ status: 'ok', storyId: 'story_1', branchId: 'br_1' })
    expect(selectSpy).toHaveBeenCalledTimes(10)

    const open = currentStoryStore.getCurrentStory()
    expect(open?.storyId).toBe('story_1')
    expect(open?.branchId).toBe('br_1')
    expect(open?.definition).toEqual(STORY_DEFINITION)
    expect(open?.settings).toEqual(STORY_SETTINGS)

    expect(entriesStore.getLoadedBranch()).toBe('br_1')
    expect([...entriesStore.getEntries().values()].map((e) => e.id)).toEqual(['e_1'])

    expect(entitiesStore.getLoadedBranch()).toBe('br_1')
    expect([...entitiesStore.getEntities().values()].map((e) => e.id)).toEqual(['char_1'])

    expect(loreStore.getLoadedBranch()).toBe('br_1')
    expect([...loreStore.getLore().values()].map((l) => l.id)).toEqual(['lore_1'])
    expect(loreStore.getById('lore_2')).toBeUndefined()

    expect(threadsStore.getLoadedBranch()).toBe('br_1')
    expect([...threadsStore.getThreads().values()].map((r) => r.id)).toEqual(['thread_1'])
    expect(happeningsStore.getLoadedBranch()).toBe('br_1')
    expect([...happeningsStore.getHappenings().values()].map((r) => r.id)).toEqual(['hap_1'])
    expect(happeningInvolvementsStore.getByHappening('hap_1').map((r) => r.id)).toEqual(['hinv_1'])
    expect(happeningAwarenessStore.getByHappening('hap_1').map((r) => r.id)).toEqual(['haw_1'])
    expect(chaptersStore.getLoadedBranch()).toBe('br_1')
    expect([...chaptersStore.getChapters().values()].map((r) => r.id)).toEqual(['chap_1'])

    expect(characterRelationshipsStore.getLoadedBranch()).toBe('br_1')
    expect(characterRelationshipsStore.getRelationships('char_1', 'br_1')).toEqual([
      { rowId: 'rel_1', otherId: 'char_2', selfToOther: 'ally', otherToSelf: null },
    ])

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
