import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { assets, branches, deltas, entryAssets, stories, type NewEntryAsset } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { registerEntryAssets } from './register'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'
import type { PipelineAction } from '../types'

async function setup() {
  __resetRegistry()
  registerEntryAssets()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  // entry_assets.asset_id is FK -> assets.id; seed a row so the link insert satisfies it.
  await db.insert(assets).values({ id: 'asset_1', kind: 'image', filePath: '/a', createdAt: 1 })
  return { db, ctx: { db, runInTransaction } }
}

const ENTRY_ASSET: NewEntryAsset = {
  id: 'ast_1',
  branchId: 'br_1',
  entryId: 'entry_1',
  assetId: 'asset_1',
  role: 'header',
  position: 0,
}

async function rowFor(db: Awaited<ReturnType<typeof setup>>['db'], id: string) {
  const [r] = await db.select().from(entryAssets).where(eq(entryAssets.id, id))
  return r
}

describe('entry_assets CRUD arms', () => {
  it('create writes the row and its delta', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createEntryAsset', source: 'user_edit', payload: { entry: ENTRY_ASSET } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'ast_1')).assetId).toBe('asset_1')
    expect((await db.select().from(deltas)).length).toBe(1)
  })

  it('rejects a non-string entryId on create (no row, no delta)', async () => {
    const { db, ctx } = await setup()
    const bad = { ...ENTRY_ASSET, entryId: 123 } as unknown as NewEntryAsset
    const result = await applyDeltaAction(
      {
        action: { kind: 'createEntryAsset', source: 'user_edit', payload: { entry: bad } },
        actionId: 'act_bad',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect(await rowFor(db, 'ast_1')).toBeUndefined()
    expect((await db.select().from(deltas)).length).toBe(0)
  })

  it('rejects an update whose patch has no updatable fields', async () => {
    const { ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createEntryAsset', source: 'user_edit', payload: { entry: ENTRY_ASSET } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    const result = await applyDeltaAction(
      {
        action: {
          kind: 'updateEntryAsset',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'ast_1', patch: {} },
        },
        actionId: 'act_noop',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
  })

  it('update role + position; reverse-replay restores the row', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createEntryAsset', source: 'user_edit', payload: { entry: ENTRY_ASSET } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'updateEntryAsset',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'ast_1', patch: { role: 'thumb', position: 2 } },
        },
        actionId: 'act_u',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'ast_1')).role).toBe('thumb')
    expect((await rowFor(db, 'ast_1')).position).toBe(2)

    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    const back = await rowFor(db, 'ast_1')
    expect(back.role).toBe('header')
    expect(back.position).toBe(0)
  })

  it('update can clear nullable role/position to null; reverse-replay restores', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createEntryAsset', source: 'user_edit', payload: { entry: ENTRY_ASSET } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'updateEntryAsset',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'ast_1', patch: { role: null, position: null } },
        },
        actionId: 'act_u',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'ast_1')).role).toBeNull()
    expect((await rowFor(db, 'ast_1')).position).toBeNull()

    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    const back = await rowFor(db, 'ast_1')
    expect(back.role).toBe('header')
    expect(back.position).toBe(0)
  })

  it('delete captures the full row; reverse-replay re-inserts it', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createEntryAsset', source: 'user_edit', payload: { entry: ENTRY_ASSET } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'deleteEntryAsset',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'ast_1' },
        },
        actionId: 'act_d',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(await rowFor(db, 'ast_1')).toBeUndefined()

    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    const back = await rowFor(db, 'ast_1')
    expect(back.assetId).toBe('asset_1')
    expect(back.role).toBe('header')
  })
})

// Ids repeat across branches (the key is branch and id), so every read and write is scoped.
describe('branch scope', () => {
  const MAIN: NewEntryAsset = {
    id: 'ast_1',
    branchId: 'br_1',
    entryId: 'entry_main',
    assetId: 'asset_1',
    role: 'header',
    position: 0,
  }
  const FORK: NewEntryAsset = {
    id: 'ast_1',
    branchId: 'br_2',
    entryId: 'entry_fork',
    assetId: 'asset_2',
    role: 'inline',
    position: 3,
  }

  type Fixture = Awaited<ReturnType<typeof setup>>

  // An id-only read scans in insertion order, so the sibling's row goes in first.
  async function forked({ written }: { written: boolean }) {
    const fixture = await setup()
    await fixture.db
      .insert(branches)
      .values({ id: 'br_2', storyId: 'story_1', name: 'fork', createdAt: 2 })
    await fixture.db
      .insert(assets)
      .values({ id: 'asset_2', kind: 'image', filePath: '/b', createdAt: 2 })
    await fixture.db.insert(entryAssets).values([MAIN, ...(written ? [FORK] : [])])
    return fixture
  }

  const linkOn = async (db: Fixture['db'], branchId: string) =>
    (
      await db
        .select()
        .from(entryAssets)
        .where(and(eq(entryAssets.branchId, branchId), eq(entryAssets.id, 'ast_1')))
    )[0]

  const undoPayloadsOf = async (db: Fixture['db'], actionId: string) =>
    (await db.select().from(deltas).where(eq(deltas.actionId, actionId))).map(
      (delta) => delta.undoPayload,
    )

  const onFork = (ctx: Fixture['ctx'], action: PipelineAction, actionId: string) =>
    applyDeltaAction({ action, actionId, branchId: 'br_2' }, ctx)

  it("createEntryAsset pair: creates the row on its own branch beside another branch's same id, and its reversal removes only that row", async () => {
    const { db, ctx } = await forked({ written: false })
    const create: PipelineAction = {
      kind: 'createEntryAsset',
      source: 'user_edit',
      payload: { entry: FORK },
    }
    expect(await onFork(ctx, create, 'act_c')).toMatchObject({ status: 'ok' })
    expect(await linkOn(db, 'br_2')).toEqual(FORK)
    expect(await linkOn(db, 'br_1')).toEqual(MAIN)

    expect(await reverseReplayDeltas('act_c', ctx)).toBe(1)
    expect(await linkOn(db, 'br_2')).toBeUndefined()
    expect(await linkOn(db, 'br_1')).toEqual(MAIN)
  })

  it("updateEntryAsset pair: updates only its own branch's row, recording that row's priors, and its reversal restores it", async () => {
    const { db, ctx } = await forked({ written: true })
    const update: PipelineAction = {
      kind: 'updateEntryAsset',
      source: 'user_edit',
      payload: { branchId: 'br_2', id: 'ast_1', patch: { role: 'thumb', position: 5 } },
    }
    expect(await onFork(ctx, update, 'act_u')).toMatchObject({ status: 'ok' })
    expect(await linkOn(db, 'br_2')).toEqual({ ...FORK, role: 'thumb', position: 5 })
    expect(await linkOn(db, 'br_1')).toEqual(MAIN)
    expect(await undoPayloadsOf(db, 'act_u')).toEqual([{ role: 'inline', position: 3 }])

    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    expect(await linkOn(db, 'br_2')).toEqual(FORK)
    expect(await linkOn(db, 'br_1')).toEqual(MAIN)
  })

  it("deleteEntryAsset pair: deletes only its own branch's row, and its reversal restores that row", async () => {
    const { db, ctx } = await forked({ written: true })
    const remove: PipelineAction = {
      kind: 'deleteEntryAsset',
      source: 'user_edit',
      payload: { branchId: 'br_2', id: 'ast_1' },
    }
    expect(await onFork(ctx, remove, 'act_d')).toMatchObject({ status: 'ok' })
    expect(await linkOn(db, 'br_2')).toBeUndefined()
    expect(await linkOn(db, 'br_1')).toEqual(MAIN)

    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    expect(await linkOn(db, 'br_2')).toEqual(FORK)
    expect(await linkOn(db, 'br_1')).toEqual(MAIN)
  })

  const PAYLOAD_CASES: { action: PipelineAction; reason: string }[] = [
    {
      action: {
        kind: 'createEntryAsset',
        source: 'user_edit',
        payload: { entry: { ...MAIN, id: 'ast_2' } },
      },
      reason: 'branch mismatch: delta br_2 vs entry br_1',
    },
    {
      action: {
        kind: 'updateEntryAsset',
        source: 'user_edit',
        payload: { branchId: 'br_1', id: 'ast_1', patch: { role: 'thumb' } },
      },
      reason: 'branch mismatch: delta br_2 vs target br_1',
    },
    {
      action: {
        kind: 'deleteEntryAsset',
        source: 'user_edit',
        payload: { branchId: 'br_1', id: 'ast_1' },
      },
      reason: 'branch mismatch: delta br_2 vs target br_1',
    },
  ]

  it.each(PAYLOAD_CASES.map((c) => [c.action.kind, c] as const))(
    '%s payload: refuses a payload naming another branch and writes neither branch',
    async (_kind, { action, reason }) => {
      const { db, ctx } = await forked({ written: true })
      expect(await onFork(ctx, action, 'act_p')).toEqual({ status: 'rejected', reason })
      expect(await linkOn(db, 'br_1')).toEqual(MAIN)
      expect(await linkOn(db, 'br_2')).toEqual(FORK)
      expect(await db.select().from(entryAssets).where(eq(entryAssets.id, 'ast_2'))).toEqual([])
      expect(await undoPayloadsOf(db, 'act_p')).toEqual([])
    },
  )
})
