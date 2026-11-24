import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branchEraFlips, branches, deltas, stories, type NewBranchEraFlip } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { eraFlipsStore } from '@/lib/stores'

import { registerBranchEraFlips } from './register'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'
import type { PipelineAction } from '../types'

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
    expect(eraFlipsStore.getById('br_1', 'ef_1')?.atWorldtime).toBe(1000)
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
    expect(eraFlipsStore.getById('br_2', 'ef_1')).toBeUndefined()
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
    expect(eraFlipsStore.getById('br_1', 'ef_1')?.eraName).toBe('Age of Storms')

    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    const back = await rowFor(db, 'ef_1')
    expect(back.atWorldtime).toBe(1000)
    expect(back.eraName).toBe('Age of Ash')
    expect(eraFlipsStore.getById('br_1', 'ef_1')?.atWorldtime).toBe(1000)
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
    expect(eraFlipsStore.getById('br_1', 'ef_1')).toBeUndefined()

    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    expect((await rowFor(db, 'ef_1')).eraName).toBe('Age of Ash')
    expect(eraFlipsStore.getById('br_1', 'ef_1')?.eraName).toBe('Age of Ash')
  })
})

// Era flip ids repeat across branches (the key is branch and id), so every read and write is scoped.
describe('branch scope', () => {
  const MAIN: NewBranchEraFlip = {
    id: 'ef_1',
    branchId: 'br_1',
    atWorldtime: 1000,
    eraName: 'Age of Ash',
    createdAt: 1,
  }
  const FORK: NewBranchEraFlip = {
    id: 'ef_1',
    branchId: 'br_2',
    atWorldtime: 3000,
    eraName: 'Age of Rain',
    createdAt: 2,
  }

  type Fixture = Awaited<ReturnType<typeof setup>>

  async function forked(seeded: readonly NewBranchEraFlip[]) {
    const fixture = await setup()
    await fixture.db
      .insert(branches)
      .values({ id: 'br_2', storyId: 'story_1', name: 'fork', createdAt: 2 })
    await fixture.db.insert(branchEraFlips).values([...seeded])
    return fixture
  }

  const flipOn = async (db: Fixture['db'], branchId: string) =>
    (
      await db
        .select()
        .from(branchEraFlips)
        .where(and(eq(branchEraFlips.branchId, branchId), eq(branchEraFlips.id, 'ef_1')))
    )[0]

  const undoPayloadsOf = async (db: Fixture['db'], actionId: string) =>
    (await db.select().from(deltas).where(eq(deltas.actionId, actionId))).map(
      (delta) => delta.undoPayload,
    )

  const onFork = (ctx: Fixture['ctx'], action: PipelineAction, actionId: string) =>
    applyDeltaAction({ action, actionId, branchId: 'br_2' }, ctx)

  it("createBranchEraFlip pair: creates the row on its own branch beside another branch's same id, and its reversal removes only that row", async () => {
    const { db, ctx } = await forked([MAIN])
    const create: PipelineAction = {
      kind: 'createBranchEraFlip',
      source: 'user_edit',
      payload: { entry: FORK },
    }
    expect(await onFork(ctx, create, 'act_c')).toMatchObject({ status: 'ok' })
    expect(await flipOn(db, 'br_2')).toEqual(FORK)
    expect(await flipOn(db, 'br_1')).toEqual(MAIN)

    expect(await reverseReplayDeltas('act_c', ctx)).toBe(1)
    expect(await flipOn(db, 'br_2')).toBeUndefined()
    expect(await flipOn(db, 'br_1')).toEqual(MAIN)
  })

  it("updateBranchEraFlip pair: updates only its own branch's row, recording that row's priors, and its reversal restores it", async () => {
    const { db, ctx } = await forked([MAIN, FORK])
    const update: PipelineAction = {
      kind: 'updateBranchEraFlip',
      source: 'user_edit',
      payload: {
        branchId: 'br_2',
        id: 'ef_1',
        patch: { atWorldtime: 2000, eraName: 'Age of Storms' },
      },
    }
    expect(await onFork(ctx, update, 'act_u')).toMatchObject({ status: 'ok' })
    expect(await flipOn(db, 'br_2')).toEqual({
      ...FORK,
      atWorldtime: 2000,
      eraName: 'Age of Storms',
    })
    expect(await flipOn(db, 'br_1')).toEqual(MAIN)
    expect(await undoPayloadsOf(db, 'act_u')).toEqual([
      { atWorldtime: 3000, eraName: 'Age of Rain' },
    ])

    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    expect(await flipOn(db, 'br_2')).toEqual(FORK)
    expect(await flipOn(db, 'br_1')).toEqual(MAIN)
  })

  it("deleteBranchEraFlip pair: deletes only its own branch's row, and its reversal restores that row", async () => {
    const { db, ctx } = await forked([MAIN, FORK])
    const remove: PipelineAction = {
      kind: 'deleteBranchEraFlip',
      source: 'user_edit',
      payload: { branchId: 'br_2', id: 'ef_1' },
    }
    expect(await onFork(ctx, remove, 'act_d')).toMatchObject({ status: 'ok' })
    expect(await flipOn(db, 'br_2')).toBeUndefined()
    expect(await flipOn(db, 'br_1')).toEqual(MAIN)

    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    expect(await flipOn(db, 'br_2')).toEqual(FORK)
    expect(await flipOn(db, 'br_1')).toEqual(MAIN)
  })

  const PAYLOAD_CASES: { action: PipelineAction; reason: string }[] = [
    {
      action: {
        kind: 'createBranchEraFlip',
        source: 'user_edit',
        payload: { entry: { ...MAIN, id: 'ef_2', atWorldtime: 5000 } },
      },
      reason: 'branch mismatch: delta br_2 vs entry br_1',
    },
    {
      action: {
        kind: 'updateBranchEraFlip',
        source: 'user_edit',
        payload: { branchId: 'br_1', id: 'ef_1', patch: { eraName: 'Age of Storms' } },
      },
      reason: 'branch mismatch: delta br_2 vs target br_1',
    },
    {
      action: {
        kind: 'deleteBranchEraFlip',
        source: 'user_edit',
        payload: { branchId: 'br_1', id: 'ef_1' },
      },
      reason: 'branch mismatch: delta br_2 vs target br_1',
    },
  ]

  it.each(PAYLOAD_CASES.map((c) => [c.action.kind, c] as const))(
    '%s payload: refuses a payload naming another branch and writes neither branch',
    async (_kind, { action, reason }) => {
      const { db, ctx } = await forked([MAIN, FORK])
      expect(await onFork(ctx, action, 'act_p')).toEqual({ status: 'rejected', reason })
      expect(await flipOn(db, 'br_1')).toEqual(MAIN)
      expect(await flipOn(db, 'br_2')).toEqual(FORK)
      expect(await db.select().from(branchEraFlips).where(eq(branchEraFlips.id, 'ef_2'))).toEqual(
        [],
      )
      expect(await undoPayloadsOf(db, 'act_p')).toEqual([])
    },
  )
})
