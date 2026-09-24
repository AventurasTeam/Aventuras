import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  branches,
  entities,
  stories,
  storyDefinitionSchema,
  storySettingsSchema,
  type NewEntity,
  type StoryDefinition,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { currentStoryStore, generationStore, resetAllStores, storiesStore } from '@/lib/stores'

import { setStoryLead } from './set-lead'

const DEFINITION = storyDefinitionSchema.parse({
  mode: 'adventure',
  leadEntityId: 'char_kael',
  narration: 'second',
  genre: { label: 'Fantasy', promptBody: 'high fantasy' },
  tone: { label: 'Wry', promptBody: 'wry' },
  setting: 'A drowned city.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
})
const SETTINGS = storySettingsSchema.parse({
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

const entity = (
  id: string,
  kind: NewEntity['kind'],
  status: NewEntity['status'],
  branchId = 'br_1',
): NewEntity => ({
  id,
  branchId,
  kind,
  name: id,
  status,
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
})

async function setup(status: 'active' | 'draft' = 'active') {
  resetAllStores()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({
    id: 'story_1',
    title: 'T',
    status,
    createdAt: 1,
    updatedAt: 1,
    currentBranchId: 'br_1',
    definition: DEFINITION,
    settings: SETTINGS,
  })
  await db.insert(branches).values([
    { id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 },
    { id: 'br_2', storyId: 'story_1', name: 'fork', createdAt: 1 },
  ])
  await db
    .insert(entities)
    .values([
      entity('char_kael', 'character', 'active'),
      entity('char_mira', 'character', 'active'),
      entity('char_sage', 'character', 'staged'),
      entity('loc_hollow', 'location', 'active'),
      entity('char_other', 'character', 'active', 'br_2'),
    ])
  currentStoryStore.set({
    storyId: 'story_1',
    branchId: 'br_1',
    definition: DEFINITION,
    settings: SETTINGS,
  })
  return { db, ctx: { db, runInTransaction } }
}

async function storedLead(db: Awaited<ReturnType<typeof setup>>['db']) {
  const [row] = await db
    .select({ definition: stories.definition })
    .from(stories)
    .where(eq(stories.id, 'story_1'))
  return (row.definition as StoryDefinition).leadEntityId
}

async function storedUpdatedAt(db: Awaited<ReturnType<typeof setup>>['db']) {
  const [row] = await db
    .select({ updatedAt: stories.updatedAt })
    .from(stories)
    .where(eq(stories.id, 'story_1'))
  return row.updatedAt
}

beforeEach(() => {
  resetAllStores()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('setStoryLead', () => {
  it('sets the lead, keeps the rest of the definition, and refreshes both stores', async () => {
    const { db, ctx } = await setup()
    expect(await setStoryLead('story_1', 'char_mira', ctx, 500)).toEqual({ status: 'ok' })
    expect(await storedLead(db)).toBe('char_mira')
    expect(await storedUpdatedAt(db)).toBe(500)
    expect(currentStoryStore.getCurrentStory()?.definition).toEqual({
      ...DEFINITION,
      leadEntityId: 'char_mira',
    })
    const row = storiesStore.getStories().rows.find((r) => r.id === 'story_1')
    expect((row?.definition as StoryDefinition).leadEntityId).toBe('char_mira')
  })

  it('leaves a different open story untouched', async () => {
    const { db, ctx } = await setup()
    await db.insert(stories).values({
      id: 'story_2',
      title: 'T2',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
      currentBranchId: 'br_3',
      definition: DEFINITION,
      settings: SETTINGS,
    })
    await db
      .insert(branches)
      .values([{ id: 'br_3', storyId: 'story_2', name: 'main', createdAt: 1 }])
    currentStoryStore.set({
      storyId: 'story_2',
      branchId: 'br_3',
      definition: DEFINITION,
      settings: SETTINGS,
    })
    expect(await setStoryLead('story_1', 'char_mira', ctx)).toEqual({ status: 'ok' })
    expect(currentStoryStore.getCurrentStory()).toEqual({
      storyId: 'story_2',
      branchId: 'br_3',
      definition: DEFINITION,
      settings: SETTINGS,
    })
  })

  it.each([
    ['loc_hollow', 'not-character'],
    ['char_sage', 'not-active'],
    ['char_other', 'wrong-branch'],
  ])('refuses %s with %s and writes nothing', async (id, code) => {
    const { db, ctx } = await setup()
    expect(await setStoryLead('story_1', id, ctx)).toEqual({ status: 'rejected', code })
    expect(await storedLead(db)).toBe('char_kael')
  })

  it('refuses while generation is in flight', async () => {
    const { db, ctx } = await setup()
    vi.spyOn(generationStore, 'isUserEditBlocked').mockReturnValue(true)
    expect(await setStoryLead('story_1', 'char_mira', ctx)).toEqual({
      status: 'rejected',
      code: 'in-flight',
    })
    expect(await storedLead(db)).toBe('char_kael')
  })

  it('refuses a draft story', async () => {
    const { db, ctx } = await setup('draft')
    expect(await setStoryLead('story_1', 'char_mira', ctx)).toEqual({
      status: 'rejected',
      code: 'draft-story',
    })
    expect(await storedLead(db)).toBe('char_kael')
  })

  it('throws for a missing story', async () => {
    const { ctx } = await setup()
    await expect(setStoryLead('story_missing', 'char_mira', ctx)).rejects.toThrow('Story not found')
  })
})
