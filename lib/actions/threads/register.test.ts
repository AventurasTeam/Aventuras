import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, deltas, stories, threads, type NewThread } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { threadsStore } from '@/lib/stores'

import { registerThreads } from './register'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'

async function setup() {
  __resetRegistry()
  registerThreads()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  threadsStore.__reset()
  threadsStore.hydrate('br_1', [])
  return { db, ctx: { db, runInTransaction } }
}

const THREAD: NewThread = {
  id: 'thr_1',
  branchId: 'br_1',
  title: 'Recover the relic',
  description: 'A quest line.',
  category: 'quest',
  icon: 'sword',
  status: 'pending',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
}

async function rowFor(db: Awaited<ReturnType<typeof setup>>['db'], id: string) {
  const [r] = await db.select().from(threads).where(eq(threads.id, id))
  return r
}

describe('threads CRUD arms', () => {
  it('create writes the row + create-patch into the held-branch store', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createThread', source: 'chapter_close', payload: { entry: THREAD } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'thr_1')).title).toBe('Recover the relic')
    expect(threadsStore.getById('thr_1')?.status).toBe('pending')
  })

  it('a write to a non-held branch no-ops against the store', async () => {
    const { db, ctx } = await setup()
    threadsStore.hydrate('br_2', [])
    await applyDeltaAction(
      {
        action: { kind: 'createThread', source: 'chapter_close', payload: { entry: THREAD } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'thr_1')).title).toBe('Recover the relic')
    expect(threadsStore.getById('thr_1')).toBeUndefined()
  })

  it('rejects an empty-set update (no updatable fields → no throw, no delta)', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createThread', source: 'chapter_close', payload: { entry: THREAD } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    const result = await applyDeltaAction(
      {
        action: {
          kind: 'updateThread',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'thr_1', patch: {} },
        },
        actionId: 'act_noop',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect((await rowFor(db, 'thr_1')).title).toBe('Recover the relic') // unchanged
    expect((await db.select().from(deltas)).length).toBe(1) // only the create delta
  })

  it('rejects an unknown status on create (no row, no delta)', async () => {
    const { db, ctx } = await setup()
    const bad = { ...THREAD, status: 'abandoned' } as unknown as NewThread
    const result = await applyDeltaAction(
      {
        action: { kind: 'createThread', source: 'chapter_close', payload: { entry: bad } },
        actionId: 'act_bad',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect(await rowFor(db, 'thr_1')).toBeUndefined()
    expect((await db.select().from(deltas)).length).toBe(0)
  })

  it('update on status + entry-ref produces a whole-value undo; reverse-replay restores row + store', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createThread', source: 'chapter_close', payload: { entry: THREAD } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )

    await applyDeltaAction(
      {
        action: {
          kind: 'updateThread',
          source: 'user_edit',
          payload: {
            branchId: 'br_1',
            id: 'thr_1',
            patch: { status: 'active', triggeredAtEntryId: 'se_5' },
          },
        },
        actionId: 'act_u',
        branchId: 'br_1',
      },
      ctx,
    )

    expect((await rowFor(db, 'thr_1')).status).toBe('active')
    expect(threadsStore.getById('thr_1')?.triggeredAtEntryId).toBe('se_5')

    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    const back = await rowFor(db, 'thr_1')
    expect(back.status).toBe('pending')
    expect(back.triggeredAtEntryId).toBeNull()
    expect(threadsStore.getById('thr_1')?.status).toBe('pending')
  })

  it('normalizes an empty-string entry ref to null on update', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'createThread',
          source: 'chapter_close',
          payload: { entry: { ...THREAD, triggeredAtEntryId: 'se_5' } },
        },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'updateThread',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'thr_1', patch: { triggeredAtEntryId: '' } },
        },
        actionId: 'act_u',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'thr_1')).triggeredAtEntryId).toBeNull()
  })

  it('normalizes an empty-string entry ref to null on create', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'createThread',
          source: 'chapter_close',
          payload: { entry: { ...THREAD, triggeredAtEntryId: '' } },
        },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'thr_1')).triggeredAtEntryId).toBeNull()
  })

  it('delete captures the full row; reverse-replay re-inserts + store create-patch', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createThread', source: 'chapter_close', payload: { entry: THREAD } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'deleteThread',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'thr_1' },
        },
        actionId: 'act_d',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(await rowFor(db, 'thr_1')).toBeUndefined()
    expect(threadsStore.getById('thr_1')).toBeUndefined()

    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    expect((await rowFor(db, 'thr_1')).title).toBe('Recover the relic')
    expect(threadsStore.getById('thr_1')?.title).toBe('Recover the relic')
  })
})
