import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { branches, storyEntries } from '@/lib/db'
import { resetAllStores } from '@/lib/stores'

import { charactersInSceneAfter } from './later-scene'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'

// Real `prefix_<uuid>` ids, as a scene holds them.
const PIP = 'char_00000000-0000-4000-8000-00000000c001'
const PEW = 'char_00000000-0000-4000-8000-00000000c002'
const BESS = 'char_00000000-0000-4000-8000-00000000c003'
const LANTERN = 'item_00000000-0000-4000-8000-00000000c004'

// The fixture's entries by index: 6 is E (the third reply, position 7), 7 the action after it,
// 8 the reply after that (position 9), 12 the last reply (position 13).
const END = 6

async function setSceneOf(
  f: CloseFixture,
  entryId: string,
  ids: readonly unknown[],
): Promise<void> {
  const where = and(eq(storyEntries.branchId, f.branchId), eq(storyEntries.id, entryId))
  const [row] = await f.ctx.db
    .select({ metadata: storyEntries.metadata })
    .from(storyEntries)
    .where(where)
  if (!row?.metadata) throw new Error(`setSceneOf: entry ${entryId} has no metadata`)
  await f.ctx.db
    .update(storyEntries)
    .set({ metadata: { ...row.metadata, sceneEntities: [...ids] as string[] } })
    .where(where)
}

afterEach(() => {
  resetAllStores()
})

describe('charactersInSceneAfter', () => {
  it("reads the scene of each reply after E, and no action's, nor E's or an earlier reply's", async () => {
    const f = await openCloseFixture()
    await setSceneOf(f, f.entries[2]!.id, [BESS])
    await setSceneOf(f, f.entries[END]!.id, [BESS])
    // The action after E carries E's scene forward; reading it would refuse a death at E.
    await setSceneOf(f, f.entries[END + 1]!.id, [PEW])
    await setSceneOf(f, f.entries[END + 2]!.id, [PIP, LANTERN])
    await setSceneOf(f, f.entries[12]!.id, [PIP])

    const later = await charactersInSceneAfter(
      { db: f.ctx.db, branchId: f.branchId },
      f.entries[END]!.id,
    )

    expect(later).toEqual(new Set([PIP, LANTERN]))
  })

  it("reads only its own branch's replies", async () => {
    const f = await openCloseFixture()
    await f.ctx.db
      .insert(branches)
      .values({ id: 'br_close_fork', storyId: f.storyId, name: 'fork', createdAt: 1 })
    await f.ctx.db.insert(storyEntries).values({
      id: 'entry_fork_009',
      branchId: 'br_close_fork',
      position: 9,
      kind: 'ai_reply',
      content: 'Bess waits at the far landing.',
      chapterId: null,
      metadata: { sceneEntities: [BESS], currentLocationId: null, worldTime: 540 },
      createdAt: 9,
    })

    const later = await charactersInSceneAfter(
      { db: f.ctx.db, branchId: f.branchId },
      f.entries[END]!.id,
    )

    expect(later).toEqual(new Set())
  })

  it('skips a reply with no metadata and a scene entry that is no string', async () => {
    const f = await openCloseFixture()
    await f.ctx.db
      .update(storyEntries)
      .set({ metadata: null })
      .where(
        and(eq(storyEntries.branchId, f.branchId), eq(storyEntries.id, f.entries[END + 2]!.id)),
      )
    await setSceneOf(f, f.entries[10]!.id, [PIP, 7, null])

    const later = await charactersInSceneAfter(
      { db: f.ctx.db, branchId: f.branchId },
      f.entries[END]!.id,
    )

    expect(later).toEqual(new Set([PIP]))
  })

  it('throws for an end entry the branch does not hold', async () => {
    const f = await openCloseFixture()

    await expect(
      charactersInSceneAfter({ db: f.ctx.db, branchId: f.branchId }, 'entry_close_999'),
    ).rejects.toThrow('entry_close_999')
  })
})
