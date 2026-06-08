import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branchEraFlips, branches, deltas, stories, type NewBranchEraFlip } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { eraFlipsStore } from '@/lib/stores'

import { registerBranchEraFlips } from './register'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'

async function setup() {
  __resetRegistry()
  registerBranchEraFlips()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  eraFlipsStore.__reset()
  eraFlipsStore.hydrate('br_1', [])
  return { db, ctx: { db, runInTransaction } }
}

const FLIP: NewBranchEraFlip = {
  id: 'ef_1',
  branchId: 'br_1',
  atWorldtime: 1000,
  eraName: 'Age of Ash',
  createdAt: 1,
}

async function rowFor(db: Awaited<ReturnType<typeof setup>>['db'], id: string) {
  const [r] = await db.select().from(branchEraFlips).where(eq(branchEraFlips.id, id))
  return r
}

describe('branch_era_flips CRUD arms', () => {
  it('create writes the row + create-patch into the held-branch store', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createBranchEraFlip', source: 'user_edit', payload: { entry: FLIP } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'ef_1')).eraName).toBe('Age of Ash')
    expect(eraFlipsStore.getById('ef_1')?.atWorldtime).toBe(1000)
  })

  it('a write to a non-held branch no-ops against the store', async () => {
    const { db, ctx } = await setup()
    eraFlipsStore.hydrate('br_2', [])
    await applyDeltaAction(
      {
        action: { kind: 'createBranchEraFlip', source: 'user_edit', payload: { entry: FLIP } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'ef_1')).eraName).toBe('Age of Ash')
    expect(eraFlipsStore.getById('ef_1')).toBeUndefined()
  })

  it('rejects a negative at_worldtime on create (no row, no delta)', async () => {
    const { db, ctx } = await setup()
    const bad: NewBranchEraFlip = { ...FLIP, atWorldtime: -1 }
    const result = await applyDeltaAction(
      {
        action: { kind: 'createBranchEraFlip', source: 'user_edit', payload: { entry: bad } },
        actionId: 'act_bad',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect(await rowFor(db, 'ef_1')).toBeUndefined()
    expect((await db.select().from(deltas)).length).toBe(0)
  })

  it('rejects a negative at_worldtime on update (row + delta unchanged)', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createBranchEraFlip', source: 'user_edit', payload: { entry: FLIP } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    const result = await applyDeltaAction(
      {
        action: {
          kind: 'updateBranchEraFlip',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'ef_1', patch: { atWorldtime: -1 } },
        },
        actionId: 'act_bad',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect((await rowFor(db, 'ef_1')).atWorldtime).toBe(1000) // unchanged
    expect((await db.select().from(deltas)).length).toBe(1) // only the create delta
  })

  it('rejects an empty update patch (no throw, no delta)', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createBranchEraFlip', source: 'user_edit', payload: { entry: FLIP } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    const result = await applyDeltaAction(
      {
        action: {
          kind: 'updateBranchEraFlip',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'ef_1', patch: {} },
        },
        actionId: 'act_noop',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect((await rowFor(db, 'ef_1')).eraName).toBe('Age of Ash') // unchanged
    expect((await db.select().from(deltas)).length).toBe(1) // only the create delta
  })

  it('update on at_worldtime + era_name produces a whole-value undo; reverse-replay restores row + store', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createBranchEraFlip', source: 'user_edit', payload: { entry: FLIP } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )

    await applyDeltaAction(
      {
        action: {
          kind: 'updateBranchEraFlip',
          source: 'user_edit',
          payload: {
            branchId: 'br_1',
            id: 'ef_1',
            patch: { atWorldtime: 2000, eraName: 'Age of Storms' },
          },
        },
        actionId: 'act_u',
        branchId: 'br_1',
      },
      ctx,
    )

    expect((await rowFor(db, 'ef_1')).atWorldtime).toBe(2000)
    expect(eraFlipsStore.getById('ef_1')?.eraName).toBe('Age of Storms')

    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    const back = await rowFor(db, 'ef_1')
    expect(back.atWorldtime).toBe(1000)
    expect(back.eraName).toBe('Age of Ash')
    expect(eraFlipsStore.getById('ef_1')?.atWorldtime).toBe(1000)
  })

  it('delete captures the full row; reverse-replay re-inserts + store create-patch', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createBranchEraFlip', source: 'user_edit', payload: { entry: FLIP } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'deleteBranchEraFlip',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'ef_1' },
        },
        actionId: 'act_d',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(await rowFor(db, 'ef_1')).toBeUndefined()
    expect(eraFlipsStore.getById('ef_1')).toBeUndefined()

    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    expect((await rowFor(db, 'ef_1')).eraName).toBe('Age of Ash')
    expect(eraFlipsStore.getById('ef_1')?.eraName).toBe('Age of Ash')
  })
})
