import { beforeEach, describe, expect, it } from 'vitest'

import {
  branches,
  entities,
  lore,
  STORY_SETTINGS_DEFAULTS,
  storyDefinitionSchema,
  storyEntries,
  storySettingsSchema,
  stories,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  chaptersStore,
  characterRelationshipsStore,
  currentStoryStore,
  entitiesStore,
  entriesStore,
  eraFlipsStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
  happeningsStore,
  loreStore,
  resetAllStores,
  threadsStore,
  translationsStore,
} from '@/lib/stores'

import { fillWorkingSet, loadOpenStory, readBranchWorkingSet } from './operational'

const DEFINITION = storyDefinitionSchema.parse({
  mode: 'creative',
  narration: 'third',
  genre: { label: 'Fantasy', promptBody: '' },
  tone: { label: 'Wry', promptBody: '' },
  setting: '',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
})

async function seed() {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({
    id: 'story_1',
    title: 'Aria',
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    currentBranchId: 'br_1',
    definition: DEFINITION,
    settings: STORY_SETTINGS_DEFAULTS,
  })
  await db.insert(branches).values([
    { id: 'br_1', storyId: 'story_1', name: 'Main', createdAt: 1 },
    { id: 'br_2', storyId: 'story_1', name: 'The road', parentBranchId: 'br_1', createdAt: 2 },
  ])
  await db.insert(storyEntries).values([
    {
      id: 'e_1',
      branchId: 'br_1',
      position: 1,
      kind: 'opening',
      content: 'The keep looms.',
      createdAt: 1,
    },
    {
      id: 'e_2',
      branchId: 'br_2',
      position: 1,
      kind: 'opening',
      content: 'The road bends.',
      createdAt: 1,
    },
  ])
  await db.insert(entities).values([
    {
      id: 'char_1',
      branchId: 'br_1',
      kind: 'character',
      name: 'Aria',
      status: 'active',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'char_2',
      branchId: 'br_2',
      kind: 'character',
      name: 'Kael',
      status: 'active',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    },
  ])
  await db.insert(lore).values([
    {
      id: 'lore_1',
      branchId: 'br_1',
      title: 'The Veil',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'lore_2',
      branchId: 'br_2',
      title: 'The Ford',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    },
  ])
  return { ctx: { db, runInTransaction } }
}

const loadedBranches = () => ({
  entries: entriesStore.getLoadedBranch(),
  entities: entitiesStore.getLoadedBranch(),
  lore: loreStore.getLoadedBranch(),
  threads: threadsStore.getLoadedBranch(),
  happenings: happeningsStore.getLoadedBranch(),
  involvements: happeningInvolvementsStore.getLoadedBranch(),
  awareness: happeningAwarenessStore.getLoadedBranch(),
  chapters: chaptersStore.getLoadedBranch(),
  relationships: characterRelationshipsStore.getLoadedBranch(),
  translations: translationsStore.getLoadedBranch(),
  eraFlips: eraFlipsStore.getLoadedBranch(),
})

beforeEach(() => {
  resetAllStores()
})

describe('readBranchWorkingSet', () => {
  it("returns the branch's rows and its story's parsed config, and fills no store", async () => {
    const { ctx } = await seed()

    const read = await readBranchWorkingSet('br_2', ctx, () => true)

    if (read.status !== 'ok') throw new Error(`expected an ok read, got ${read.status}`)
    expect(read.set.storyId).toBe('story_1')
    expect(read.set.branchId).toBe('br_2')
    expect(read.set.definition).toEqual(DEFINITION)
    expect(read.set.settings).toEqual(storySettingsSchema.parse(STORY_SETTINGS_DEFAULTS))
    expect(read.set.entries.map((r) => r.id)).toEqual(['e_2'])
    expect(read.set.entities.map((r) => r.id)).toEqual(['char_2'])
    expect(read.set.lore.map((r) => r.id)).toEqual(['lore_2'])
    expect(loadedBranches()).toEqual({
      entries: null,
      entities: null,
      lore: null,
      threads: null,
      happenings: null,
      involvements: null,
      awareness: null,
      chapters: null,
      relationships: null,
      translations: null,
      eraFlips: null,
    })
    expect(currentStoryStore.getCurrentStory()).toBeNull()
  })
})

describe('fillWorkingSet', () => {
  it('hydrates all eleven working-set stores with the branch at once, and publishes nothing', async () => {
    const { ctx } = await seed()
    const read = await readBranchWorkingSet('br_2', ctx, () => true)
    if (read.status !== 'ok') throw new Error(`expected an ok read, got ${read.status}`)

    fillWorkingSet(read.set)

    expect(loadedBranches()).toEqual({
      entries: 'br_2',
      entities: 'br_2',
      lore: 'br_2',
      threads: 'br_2',
      happenings: 'br_2',
      involvements: 'br_2',
      awareness: 'br_2',
      chapters: 'br_2',
      relationships: 'br_2',
      translations: 'br_2',
      eraFlips: 'br_2',
    })
    expect([...entriesStore.getEntries('br_2').values()].map((r) => r.id)).toEqual(['e_2'])
    expect(currentStoryStore.getCurrentStory()).toBeNull()
  })
})

describe('loadOpenStory', () => {
  it('publishes nothing when the request goes stale between the read and the fill', async () => {
    const { ctx } = await seed()
    // The read's twelve checks pass; the load's own, after awaiting the read, is the thirteenth.
    let checks = 0

    const result = await loadOpenStory('br_1', ctx, () => ++checks < 13)

    expect(result).toEqual({ status: 'cancelled' })
    expect(checks).toBe(13)
    expect(currentStoryStore.getCurrentStory()).toBeNull()
    expect(entriesStore.getLoadedBranch()).toBeNull()
  })
})
