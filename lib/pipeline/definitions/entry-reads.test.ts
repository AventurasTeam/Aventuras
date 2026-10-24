import { describe, expect, it } from 'vitest'

import { branches, stories, storyEntries } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { readStoryPlace } from './entry-reads'

describe('readStoryPlace', () => {
  const at = (currentLocationId: string) => ({ sceneEntities: [], currentLocationId, worldTime: 0 })
  async function seed(entries: { kind: 'ai_reply' | 'user_action'; at: string }[]) {
    const { db } = await createTestDb()
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    await db.insert(storyEntries).values(
      entries.map((e, i) => ({
        id: `e${i + 1}`,
        branchId: 'b1',
        position: i + 1,
        kind: e.kind,
        content: 'x',
        metadata: at(e.at),
        createdAt: i + 1,
      })),
    )
    return db
  }

  // data-model.md → The story's place: a user_action tail can name another place than the scene.
  it("reads the tail's location and the scene source's apart", async () => {
    const db = await seed([
      { kind: 'ai_reply', at: 'loc_crypt' },
      { kind: 'user_action', at: 'loc_marsh' },
    ])
    const story = await readStoryPlace(db, 'b1')
    expect([story.tail, story.scene]).toEqual(['loc_marsh', 'loc_crypt'])
  })

  it('reads only the rows below the position it is given', async () => {
    const db = await seed([
      { kind: 'ai_reply', at: 'loc_crypt' },
      { kind: 'user_action', at: 'loc_marsh' },
      { kind: 'ai_reply', at: 'loc_keep' },
    ])
    const story = await readStoryPlace(db, 'b1', 3)
    expect([story.tail, story.scene]).toEqual(['loc_marsh', 'loc_crypt'])
    const now = await readStoryPlace(db, 'b1')
    expect([now.tail, now.scene]).toEqual(['loc_keep', 'loc_keep'])
  })
})
