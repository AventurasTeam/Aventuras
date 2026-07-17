import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import {
  branches,
  deltas,
  storyDefinitionSchema,
  storySettingsSchema,
  stories,
  type StoryDefinition,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  currentStoryStore,
  entitiesStore,
  entriesStore,
  navigationStore,
  storiesStore,
} from '@/lib/stores'

import {
  loadOpenStory,
  openStory,
  setStoryArchived,
  setStoryFavorite,
  touchStoryOpened,
} from './operational'

// openStory now runs loadOpenStory (Slice 2.7 Task 7) before navigating, which
// requires a config that parses — story_1 needs a valid definition/settings so
// the existing "resolves branch, touches, navigates" behavior stays reachable.
const STORY_DEFINITION = storyDefinitionSchema.parse({
  mode: 'adventure',
  leadEntityId: 'char_00000000-0000-4000-8000-000000000001',
  narration: 'third',
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
  const { db, sqlite, runInTransaction } = await createTestDb()
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
  await db.insert(stories).values({
    id: 'draft_1',
    title: 'Draft',
    status: 'draft',
    favorite: 0,
    createdAt: 1,
    updatedAt: 1,
  })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  storiesStore.__reset()
  navigationStore.__reset()
  currentStoryStore.__reset()
  entriesStore.__reset()
  entitiesStore.__reset()
  return { db, sqlite, ctx: { db, runInTransaction } }
}

describe('stories column writes', () => {
  it('setStoryFavorite persists + re-hydrates + writes no delta', async () => {
    const { db, ctx } = await setup()
    await setStoryFavorite('story_1', true, ctx)
    expect((await db.select().from(stories).where(eq(stories.id, 'story_1')))[0].favorite).toBe(1)
    expect(storiesStore.getStories().rows.find((r) => r.id === 'story_1')?.favorite).toBe(1)
    expect((await db.select().from(deltas)).length).toBe(0)
  })

  it('setStoryArchived toggles active<->archived; rejects drafts', async () => {
    const { db, ctx } = await setup()
    await setStoryArchived('story_1', true, ctx)
    expect((await db.select().from(stories).where(eq(stories.id, 'story_1')))[0].status).toBe(
      'archived',
    )
    await expect(setStoryArchived('draft_1', true, ctx)).rejects.toThrow(/draft/i)
    expect((await db.select().from(deltas)).length).toBe(0)
  })

  it('touchStoryOpened sets last_opened_at', async () => {
    const { db, ctx } = await setup()
    await touchStoryOpened('story_1', ctx, 12345)
    expect((await db.select().from(stories).where(eq(stories.id, 'story_1')))[0].lastOpenedAt).toBe(
      12345,
    )
  })

  it('openStory resolves branch, touches, sets navigation, navigates', async () => {
    const { ctx } = await setup()
    const navigate = vi.fn()
    const result = await openStory('story_1', ctx, navigate, 999)
    expect(result).toEqual({ status: 'ok', branchId: 'br_1' })
    expect(navigate).toHaveBeenCalledWith('br_1')
    expect(navigationStore.getNavigation()).toEqual({
      currentStoryId: 'story_1',
      currentBranchId: 'br_1',
    })
  })

  it('openStory returns no-branch when currentBranchId is null', async () => {
    const { ctx } = await setup()
    const result = await openStory('draft_1', ctx, vi.fn(), 999)
    expect(result.status).toBe('no-branch')
  })

  it('openStory still opens when the last-opened write fails', async () => {
    const { ctx } = await setup()
    const navigate = vi.fn()
    const failingCtx = { ...ctx, runInTransaction: () => Promise.reject(new Error('write failed')) }
    const result = await openStory('story_1', failingCtx, navigate, 999)
    expect(result).toEqual({ status: 'ok', branchId: 'br_1' })
    expect(navigate).toHaveBeenCalledWith('br_1')
  })

  it('loadOpenStory publishes no working-set state when the entity query fails', async () => {
    const { ctx, sqlite } = await setup()
    entriesStore.hydrate('old_branch', [])
    entitiesStore.hydrate('old_branch', [])
    const previousOpen = {
      storyId: 'old_story',
      branchId: 'old_branch',
      definition: STORY_DEFINITION,
      settings: STORY_SETTINGS,
    }
    currentStoryStore.set(previousOpen)
    sqlite.exec('DROP TABLE entities')

    await expect(loadOpenStory('br_1', ctx)).rejects.toThrow()

    expect(entriesStore.getLoadedBranch()).toBe('old_branch')
    expect(entitiesStore.getLoadedBranch()).toBe('old_branch')
    expect(currentStoryStore.getCurrentStory()).toEqual(previousOpen)
  })

  it('openStory does not navigate when the config is corrupt; badges the story', async () => {
    const { db, ctx } = await setup()
    await db.insert(stories).values({
      id: 'story_corrupt',
      title: 'Broken',
      status: 'active',
      favorite: 0,
      createdAt: 1,
      updatedAt: 1,
      currentBranchId: 'br_corrupt',
      // Missing `mode` (and the rest) — fails storyDefinitionSchema.parse.
      definition: { leadEntityId: null } as unknown as StoryDefinition,
    })
    await db
      .insert(branches)
      .values({ id: 'br_corrupt', storyId: 'story_corrupt', name: 'main', createdAt: 1 })

    const navigate = vi.fn()
    const result = await openStory('story_corrupt', ctx, navigate)

    expect(result).toEqual({ status: 'open-failed', kind: 'definition-corrupt' })
    expect(navigate).not.toHaveBeenCalled()
    expect(storiesStore.getStories().openFailures.story_corrupt).toBe('definition-corrupt')
  })
})
