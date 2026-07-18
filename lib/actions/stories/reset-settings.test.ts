import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import {
  APP_SETTINGS_DEFAULTS,
  branches,
  buildStorySettings,
  deltas,
  emptyEntityState,
  entities,
  stories,
  storyDefinitionSchema,
  storyEntries,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { hydrateAppSettings, resetAllStores, storiesStore } from '@/lib/stores'

import { resetStorySettings } from './reset-settings'

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

const HEALTHY_STORY_DEFINITION = storyDefinitionSchema.parse({
  mode: 'creative',
  leadEntityId: null,
  narration: 'third',
  genre: { label: 'Mystery', promptBody: 'cozy mystery' },
  tone: { label: 'Warm', promptBody: 'warm' },
  setting: 'A quiet village.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
})

afterEach(() => {
  resetAllStores()
})

async function hydrateCurrentDefaults(): Promise<void> {
  await hydrateAppSettings(async () => ({
    ...APP_SETTINGS_DEFAULTS,
    embeddingModelId: 'app-embed',
    defaultStorySettings: {
      ...APP_SETTINGS_DEFAULTS.defaultStorySettings,
      classifierCadence: 11,
      chapterAutoClose: false,
    },
  }))
}

describe('resetStorySettings', () => {
  it('rebuilds current defaults and preserves definition, entries, entities, and deltas', async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    const oldSettings = buildStorySettings({ classifierCadence: 2 }, 'old-embed')
    const healthySettings = buildStorySettings({ classifierCadence: 4 }, 'other-embed')

    await db.insert(stories).values([
      {
        id: 'story_1',
        title: 'Broken',
        status: 'active',
        currentBranchId: 'branch_1',
        definition: STORY_DEFINITION,
        settings: oldSettings,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'story_2',
        title: 'Healthy',
        status: 'active',
        definition: HEALTHY_STORY_DEFINITION,
        settings: healthySettings,
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    await db
      .insert(branches)
      .values({ id: 'branch_1', storyId: 'story_1', name: 'main', createdAt: 1 })
    await db.insert(storyEntries).values({
      id: 'entry_1',
      branchId: 'branch_1',
      position: 1,
      kind: 'opening',
      content: 'Opening content.',
      createdAt: 1,
    })
    await db.insert(entities).values({
      id: 'entity_1',
      branchId: 'branch_1',
      kind: 'character',
      name: 'Aria',
      status: 'active',
      injectionMode: 'auto',
      state: emptyEntityState('character'),
      createdAt: 1,
      updatedAt: 1,
    })
    await db.insert(deltas).values({
      id: 'delta_1',
      branchId: 'branch_1',
      entryId: 'entry_1',
      actionId: 'action_1',
      logPosition: 1,
      source: 'user_edit',
      targetTable: 'story_entries',
      targetId: 'entry_1',
      op: 'create',
      undoPayload: null,
      createdAt: 1,
    })
    sqlite.exec(
      `UPDATE stories SET settings = '{"classifierCadence":"broken"}' WHERE id = 'story_1'`,
    )
    await hydrateCurrentDefaults()
    storiesStore.setOpenFailure({ storyId: 'story_1', kind: 'settings-corrupt' })

    await resetStorySettings('story_1', { db, runInTransaction }, 99)

    const [recovered] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    const [healthy] = await db.select().from(stories).where(eq(stories.id, 'story_2'))
    const entryRows = await db.select().from(storyEntries)
    const entityRows = await db.select().from(entities)
    const deltaRows = await db.select().from(deltas)

    expect(recovered.settings).toEqual(
      buildStorySettings(
        {
          ...APP_SETTINGS_DEFAULTS.defaultStorySettings,
          classifierCadence: 11,
          chapterAutoClose: false,
        },
        'app-embed',
      ),
    )
    expect(recovered.definition).toEqual(STORY_DEFINITION)
    expect(recovered.updatedAt).toBe(99)
    expect(healthy.settings).toEqual(healthySettings)
    expect(entryRows).toHaveLength(1)
    expect(entityRows).toHaveLength(1)
    expect(deltaRows).toHaveLength(1)
    expect(deltaRows[0]).toMatchObject({ id: 'delta_1', actionId: 'action_1' })
    expect(storiesStore.getStories().openFailures.story_1).toBeUndefined()
  })

  it('rejects an unknown story without writing a story', async () => {
    const { db, runInTransaction } = await createTestDb()
    await hydrateCurrentDefaults()

    await expect(resetStorySettings('missing', { db, runInTransaction }, 99)).rejects.toThrow(
      'Story not found',
    )

    expect(await db.select().from(stories)).toEqual([])
  })

  it('retains the open failure when the stories mirror cannot refresh', async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    await db.insert(stories).values({
      id: 'story_1',
      title: 'Broken',
      status: 'active',
      definition: STORY_DEFINITION,
      settings: buildStorySettings({ classifierCadence: 2 }, 'old-embed'),
      createdAt: 1,
      updatedAt: 1,
    })
    await hydrateCurrentDefaults()
    storiesStore.setOpenFailure({ storyId: 'story_1', kind: 'settings-corrupt' })
    const writeThenBreakRefresh: typeof runInTransaction = async (ops) => {
      await runInTransaction(ops)
      sqlite.exec('DROP TABLE stories')
    }

    await expect(
      resetStorySettings('story_1', { db, runInTransaction: writeThenBreakRefresh }, 99),
    ).resolves.toBeUndefined()

    expect(storiesStore.getStories().openFailures.story_1).toBe('settings-corrupt')
  })

  it('retains a definition failure after successfully resetting settings', async () => {
    const { db, runInTransaction } = await createTestDb()
    await db.insert(stories).values({
      id: 'story_1',
      title: 'Broken',
      status: 'active',
      definition: STORY_DEFINITION,
      settings: buildStorySettings({ classifierCadence: 2 }, 'old-embed'),
      createdAt: 1,
      updatedAt: 1,
    })
    await hydrateCurrentDefaults()
    storiesStore.setOpenFailure({ storyId: 'story_1', kind: 'definition-corrupt' })

    await resetStorySettings('story_1', { db, runInTransaction }, 99)

    expect(storiesStore.getStories().openFailures.story_1).toBe('definition-corrupt')
  })
})
