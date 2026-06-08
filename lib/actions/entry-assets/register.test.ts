import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { assets, branches, deltas, entryAssets, stories, type NewEntryAsset } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entryAssetsStore } from '@/lib/stores'

import { registerEntryAssets } from './register'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'

async function setup() {
  __resetRegistry()
  registerEntryAssets()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  // entry_assets.asset_id is FK -> assets.id; seed a row so the link insert satisfies it.
  await db.insert(assets).values({ id: 'asset_1', kind: 'image', filePath: '/a', createdAt: 1 })
  entryAssetsStore.__reset()
  entryAssetsStore.hydrate('br_1', [])
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
  it('create writes the row + delta + create-patch into the held-branch store', async () => {
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
    expect(entryAssetsStore.getByEntry('entry_1').map((r) => r.id)).toEqual(['ast_1'])
  })

  it('a write to a non-held branch no-ops against the store', async () => {
    const { db, ctx } = await setup()
    entryAssetsStore.hydrate('br_2', [])
    await applyDeltaAction(
      {
        action: { kind: 'createEntryAsset', source: 'user_edit', payload: { entry: ENTRY_ASSET } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'ast_1')).assetId).toBe('asset_1') // DB written
    expect(entryAssetsStore.getById('ast_1')).toBeUndefined() // store no-op
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

  it('update role + position; reverse-replay restores row + store', async () => {
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
    expect(entryAssetsStore.getById('ast_1')?.position).toBe(2)

    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    const back = await rowFor(db, 'ast_1')
    expect(back.role).toBe('header')
    expect(back.position).toBe(0)
    expect(entryAssetsStore.getById('ast_1')?.role).toBe('header')
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
    expect(entryAssetsStore.getById('ast_1')?.position).toBeNull()

    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    const back = await rowFor(db, 'ast_1')
    expect(back.role).toBe('header')
    expect(back.position).toBe(0)
  })

  it('delete captures the full row; reverse-replay re-inserts + store create-patch', async () => {
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
    expect(entryAssetsStore.getById('ast_1')).toBeUndefined()

    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    expect((await rowFor(db, 'ast_1')).assetId).toBe('asset_1')
    expect(entryAssetsStore.getById('ast_1')?.role).toBe('header')
  })
})
