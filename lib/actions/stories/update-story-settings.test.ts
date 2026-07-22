import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { branches, buildStorySettings, stories, storyDefinitionSchema } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { currentStoryStore, resetAllStores } from '@/lib/stores'

import { updateStorySettings } from './update-story-settings'

const STORY_DEFINITION = storyDefinitionSchema.parse({
  mode: 'adventure',
  leadEntityId: 'entity_1',
  narration: 'third',
  genre: { label: 'Fantasy', promptBody: 'high fantasy' },
  tone: { label: 'Wry', promptBody: 'wry' },
  setting: 'A keep on a hill.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
})

afterEach(() => {
  resetAllStores()
})

async function seed() {
  const { db, sqlite, runInTransaction } = await createTestDb()
  const settings = buildStorySettings({ classifierCadence: 2 }, 'embed-a', null)
  await db.insert(stories).values({
    id: 'story_1',
    title: 'Aria',
    status: 'active',
    currentBranchId: 'branch_1',
    definition: STORY_DEFINITION,
    settings,
    createdAt: 1,
    updatedAt: 1,
  })
  await db
    .insert(branches)
    .values({ id: 'branch_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  return { db, sqlite, runInTransaction, settings }
}

describe('updateStorySettings', () => {
  it('merges the patch without clobbering sibling fields', async () => {
    const { db, runInTransaction, settings } = await seed()

    const next = await updateStorySettings(
      'story_1',
      { suggestionCount: 5 },
      { db, runInTransaction },
      99,
    )

    expect(next.suggestionCount).toBe(5)
    expect(next.classifierCadence).toBe(2)
    expect(next.embedding_model_id).toBe(settings.embedding_model_id)

    const [row] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    expect(row.settings?.suggestionCount).toBe(5)
    expect(row.settings?.classifierCadence).toBe(2)
    expect(row.updatedAt).toBe(99)
  })

  it('refreshes currentStoryStore when the updated story is open', async () => {
    const { db, runInTransaction, settings } = await seed()
    currentStoryStore.set({
      storyId: 'story_1',
      branchId: 'branch_1',
      definition: STORY_DEFINITION,
      settings,
    })

    expect(settings.suggestionsEnabled).toBe(false)

    await updateStorySettings('story_1', { suggestionsEnabled: true }, { db, runInTransaction }, 99)

    expect(currentStoryStore.getCurrentStory()?.settings.suggestionsEnabled).toBe(true)
    expect(currentStoryStore.getCurrentStory()?.settings.classifierCadence).toBe(2)
    expect(currentStoryStore.getCurrentStory()?.branchId).toBe('branch_1')
    expect(currentStoryStore.getCurrentStory()?.definition).toEqual(STORY_DEFINITION)
  })

  it('leaves currentStoryStore alone when a different story is open', async () => {
    const { db, runInTransaction, settings } = await seed()
    currentStoryStore.set({
      storyId: 'story_other',
      branchId: 'branch_other',
      definition: STORY_DEFINITION,
      settings,
    })

    await updateStorySettings('story_1', { suggestionCount: 6 }, { db, runInTransaction }, 99)

    expect(currentStoryStore.getCurrentStory()?.storyId).toBe('story_other')
    expect(currentStoryStore.getCurrentStory()?.settings.suggestionCount).toBe(
      settings.suggestionCount,
    )
  })

  it('throws for an unknown story', async () => {
    const { db, runInTransaction } = await seed()

    await expect(
      updateStorySettings('story_missing', { suggestionCount: 2 }, { db, runInTransaction }, 99),
    ).rejects.toThrow('Story not found')
  })

  it('rejects an invalid patch without writing', async () => {
    const { db, runInTransaction } = await seed()

    await expect(
      updateStorySettings(
        'story_1',
        { suggestionCount: 'lots' } as never,
        { db, runInTransaction },
        99,
      ),
    ).rejects.toThrow()

    const [row] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    expect(row.updatedAt).toBe(1)
  })
})
