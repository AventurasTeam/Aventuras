import { describe, expect, it } from 'vitest'

import { branches, stories, storyEntries } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { readRecentEntryIds, readStoryPlace } from './entry-reads'

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

// classifier.md → What the classifier reads → Known happenings.
describe('readRecentEntryIds', () => {
  // e1-e4 a closed chapter, e5 a system row, e6-e9 the open region; the window starts at e8.
  async function seed() {
    const { db } = await createTestDb()
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    await db.insert(storyEntries).values(
      Array.from({ length: 9 }, (_, i) => ({
        id: `e${i + 1}`,
        branchId: 'b1',
        position: i + 1,
        kind: i === 4 ? ('system' as const) : ('ai_reply' as const),
        content: 'x',
        chapterId: i < 4 ? 'ch1' : null,
        createdAt: i + 1,
      })),
    )
    return db
  }
  const sorted = (ids: Set<string>) => [...ids].sort()

  it.each([
    ['no reach-back stops at the open region', 0, ['e6', 'e7', 'e8', 'e9']],
    ['a reach-back inside the open region keeps all of it', 1, ['e6', 'e7', 'e8', 'e9']],
    [
      'a reach-back crosses the chapter boundary, skipping the system row',
      4,
      ['e3', 'e4', 'e6', 'e7', 'e8', 'e9'],
    ],
    [
      'a reach-back past the branch start takes the whole branch',
      20,
      ['e1', 'e2', 'e3', 'e4', 'e6', 'e7', 'e8', 'e9'],
    ],
  ])('%s', async (_name, protectedBuffer, expected) => {
    const db = await seed()
    expect(sorted(await readRecentEntryIds(db, 'b1', { firstTurn: 8, protectedBuffer }))).toEqual(
      expected,
    )
  })
})
