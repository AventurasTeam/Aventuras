import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, chapters, deltas, stories, type NewChapter } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { chaptersStore } from '@/lib/stores'

import { registerChapters } from './register'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'

async function setup() {
  // Registration is process-global; reset so only chapters is live for this test.
  __resetRegistry()
  registerChapters()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  chaptersStore.__reset()
  chaptersStore.hydrate('br_1', [])
  return { db, ctx: { db, runInTransaction } }
}

const CHAPTER: NewChapter = {
  id: 'chap_1',
  branchId: 'br_1',
  sequenceNumber: 1,
  title: 'The Gathering Storm',
  summary: 'Heroes assemble as war looms.',
  theme: 'rising tension',
  keywords: ['war', 'omen'],
  startEntryId: 'se_1',
  endEntryId: 'se_40',
  tokenCount: 24000,
  closedAt: 100,
  createdAt: 1,
  updatedAt: 1,
}

async function rowFor(db: Awaited<ReturnType<typeof setup>>['db'], id: string) {
  const [r] = await db.select().from(chapters).where(eq(chapters.id, id))
  return r
}

describe('chapters CRUD arms', () => {
  it('create writes the row + create-patch into the held-branch store', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createChapter', source: 'chapter_close', payload: { entry: CHAPTER } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'chap_1')).title).toBe('The Gathering Storm')
    expect(chaptersStore.getById('chap_1')?.keywords).toEqual(['war', 'omen'])
    expect(chaptersStore.getBySequenceNumber(1)?.id).toBe('chap_1')
  })

  it('a write to a non-held branch no-ops against the store', async () => {
    const { db, ctx } = await setup()
    chaptersStore.hydrate('br_2', []) // store now holds br_2, not br_1
    await applyDeltaAction(
      {
        action: { kind: 'createChapter', source: 'chapter_close', payload: { entry: CHAPTER } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'chap_1')).title).toBe('The Gathering Storm') // DB written
    expect(chaptersStore.getById('chap_1')).toBeUndefined() // store no-op
  })

  it('rejects a non-string keyword on create (no row, no delta)', async () => {
    const { db, ctx } = await setup()
    const bad = { ...CHAPTER, keywords: [123] } as unknown as NewChapter
    const result = await applyDeltaAction(
      {
        action: { kind: 'createChapter', source: 'chapter_close', payload: { entry: bad } },
        actionId: 'act_bad',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect(await rowFor(db, 'chap_1')).toBeUndefined()
    expect((await db.select().from(deltas)).length).toBe(0)
  })

  it('rejects an update whose patch has no updatable fields (closed_at-only — no throw, no delta)', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createChapter', source: 'chapter_close', payload: { entry: CHAPTER } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    // closed_at is in chapterWriteSchema but NOT in UPDATABLE, so it parses but yields an empty set.
    const result = await applyDeltaAction(
      {
        action: {
          kind: 'updateChapter',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'chap_1', patch: { closedAt: 999 } as never },
        },
        actionId: 'act_noop',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect((await rowFor(db, 'chap_1')).closedAt).toBe(100) // unchanged
    expect((await db.select().from(deltas)).length).toBe(1) // only the create delta
  })

  it('update on keywords (whole-array) + scalar + structural fields; reverse-replay restores row + store', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createChapter', source: 'chapter_close', payload: { entry: CHAPTER } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )

    await applyDeltaAction(
      {
        action: {
          kind: 'updateChapter',
          source: 'user_edit',
          payload: {
            branchId: 'br_1',
            id: 'chap_1',
            patch: {
              keywords: ['war'], // whole-array change (shrink)
              title: 'War Breaks', // scalar change
              summary: 'War has come.', // scalar change
              tokenCount: 26000, // scalar change
              endEntryId: 'se_45', // structural field change
            },
          },
        },
        actionId: 'act_u',
        branchId: 'br_1',
      },
      ctx,
    )

    // forward applied to DB + store
    expect((await rowFor(db, 'chap_1')).title).toBe('War Breaks')
    expect(chaptersStore.getById('chap_1')?.keywords).toEqual(['war'])

    // reverse-replay restores the whole prior array + scalars + structural field
    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    const back = await rowFor(db, 'chap_1')
    expect(back.title).toBe('The Gathering Storm')
    expect(back.summary).toBe('Heroes assemble as war looms.')
    expect(back.tokenCount).toBe(24000)
    expect(back.endEntryId).toBe('se_40')
    expect(back.keywords).toEqual(['war', 'omen'])
    expect(chaptersStore.getById('chap_1')?.keywords).toEqual(['war', 'omen'])
  })

  it('delete captures the full row; reverse-replay re-inserts + store create-patch', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createChapter', source: 'chapter_close', payload: { entry: CHAPTER } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'deleteChapter',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'chap_1' },
        },
        actionId: 'act_d',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(await rowFor(db, 'chap_1')).toBeUndefined()
    expect(chaptersStore.getById('chap_1')).toBeUndefined()

    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    expect((await rowFor(db, 'chap_1')).title).toBe('The Gathering Storm')
    expect(chaptersStore.getById('chap_1')?.title).toBe('The Gathering Storm')
  })
})
