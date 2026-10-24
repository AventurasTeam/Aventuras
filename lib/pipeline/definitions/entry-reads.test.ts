import { describe, expect, it } from 'vitest'

import { branches, stories, storyEntries } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { readStoryPlace } from './entry-reads'

describe('readStoryPlace', () => {
  // data-model.md → The story's place: a user_action tail can name another place than the scene.
  it("reads the tail's location and the scene source's apart", async () => {
    const { db } = await createTestDb()
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    const at = (currentLocationId: string) => ({
      sceneEntities: [],
      currentLocationId,
      worldTime: 0,
    })
    await db.insert(storyEntries).values([
      {
        id: 'e1',
        branchId: 'b1',
        position: 1,
        kind: 'ai_reply',
        content: 'x',
        metadata: at('loc_crypt'),
        createdAt: 1,
      },
      {
        id: 'e2',
        branchId: 'b1',
        position: 2,
        kind: 'user_action',
        content: 'y',
        metadata: at('loc_marsh'),
        createdAt: 2,
      },
    ])
    const story = await readStoryPlace(db, 'b1')
    expect([story.tail, story.scene]).toEqual(['loc_marsh', 'loc_crypt'])
  })
})
