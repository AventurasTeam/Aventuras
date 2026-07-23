import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, entities, stories, type NewEntity } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entitiesStore } from '@/lib/stores'

import { registerEntities } from './register'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'

async function setup() {
  __resetRegistry()
  registerEntities()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  entitiesStore.__reset()
  entitiesStore.hydrate('br_1', [])
  return { db, ctx: { db, runInTransaction } }
}

const CHAR: NewEntity = {
  id: 'char_1',
  branchId: 'br_1',
  kind: 'character',
  name: 'Kael',
  description: 'a wandering knight',
  status: 'staged',
  injectionMode: 'auto',
  state: {
    visual: { attire: 'travel cloak' },
    traits: ['brave'],
    drives: [],
    current_location_id: null,
    equipped_items: [],
    inventory: ['item_sword'],
    stackables: { gold: 5 },
    faction_id: null,
    lastSeenAt: null,
  },
  createdAt: 1,
  updatedAt: 1,
}

async function rowFor(db: Awaited<ReturnType<typeof setup>>['db'], id: string) {
  const [r] = await db.select().from(entities).where(eq(entities.id, id))
  return r
}

describe('updateEntityVisualState', () => {
  it('merges only the given visual sub-fields, leaving siblings and other state keys untouched', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createEntity', source: 'user_edit', payload: { entry: CHAR } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'updateEntityVisualState',
          source: 'ai_classifier',
          payload: {
            branchId: 'br_1',
            id: 'char_1',
            visual: { attire: 'cloak now muddied to the waist' },
          },
        },
        actionId: 'act_v',
        branchId: 'br_1',
      },
      ctx,
    )
    const row = await rowFor(db, 'char_1')
    expect(row.state).toMatchObject({
      visual: { attire: 'cloak now muddied to the waist' },
      inventory: ['item_sword'],
      stackables: { gold: 5 },
    })
    expect(entitiesStore.getById('char_1')?.state).toMatchObject({
      visual: { attire: 'cloak now muddied to the waist' },
    })
  })

  it('reverse-replay restores the prior visual value without touching inventory', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createEntity', source: 'user_edit', payload: { entry: CHAR } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'updateEntityVisualState',
          source: 'ai_classifier',
          payload: { branchId: 'br_1', id: 'char_1', visual: { attire: 'muddied cloak' } },
        },
        actionId: 'act_v',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(await reverseReplayDeltas('act_v', ctx)).toBe(1)
    const row = await rowFor(db, 'char_1')
    expect(row.state).toMatchObject({
      visual: { attire: 'travel cloak' },
      inventory: ['item_sword'],
    })
  })
})

describe('updateEntityInventory', () => {
  it('replaces inventory without touching equipped_items or visual', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createEntity', source: 'user_edit', payload: { entry: CHAR } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'updateEntityInventory',
          source: 'ai_classifier',
          payload: { branchId: 'br_1', id: 'char_1', inventory: ['item_sword', 'item_amulet'] },
        },
        actionId: 'act_t',
        branchId: 'br_1',
      },
      ctx,
    )
    const row = await rowFor(db, 'char_1')
    expect(row.state).toMatchObject({
      inventory: ['item_sword', 'item_amulet'],
      visual: { attire: 'travel cloak' },
    })
  })
})

describe('updateEntityStackables', () => {
  it('replaces the stackables record', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createEntity', source: 'user_edit', payload: { entry: CHAR } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'updateEntityStackables',
          source: 'ai_classifier',
          payload: { branchId: 'br_1', id: 'char_1', stackables: { gold: 4, arrows: 3 } },
        },
        actionId: 'act_s',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'char_1')).state).toMatchObject({ stackables: { gold: 4, arrows: 3 } })
  })
})

describe('updateEntityLocationTracking', () => {
  it('writes current_location_id when supplied', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createEntity', source: 'user_edit', payload: { entry: CHAR } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'updateEntityLocationTracking',
          source: 'ai_classifier',
          payload: { branchId: 'br_1', id: 'char_1', currentLocationId: 'loc_9' },
        },
        actionId: 'act_l',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'char_1')).state).toMatchObject({ current_location_id: 'loc_9' })
  })

  it('writes lastSeenAt when supplied', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createEntity', source: 'user_edit', payload: { entry: CHAR } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'updateEntityLocationTracking',
          source: 'ai_classifier',
          payload: {
            branchId: 'br_1',
            id: 'char_1',
            lastSeenAt: { entryId: 'entry_5', locationId: 'loc_2', worldTime: 300 },
          },
        },
        actionId: 'act_ls',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'char_1')).state).toMatchObject({
      lastSeenAt: { entryId: 'entry_5', locationId: 'loc_2', worldTime: 300 },
    })
  })
})

describe('promoteStagedEntity', () => {
  it('flips staged -> active', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createEntity', source: 'user_edit', payload: { entry: CHAR } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    const result = await applyDeltaAction(
      {
        action: {
          kind: 'promoteStagedEntity',
          source: 'ai_classifier',
          payload: { branchId: 'br_1', id: 'char_1' },
        },
        actionId: 'act_p',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('ok')
    expect((await rowFor(db, 'char_1')).status).toBe('active')
    expect(entitiesStore.getById('char_1')?.status).toBe('active')
  })

  it('a second emission on an already-active entity no-ops (soft reject, no delta)', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createEntity', source: 'user_edit', payload: { entry: CHAR } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'promoteStagedEntity',
          source: 'ai_classifier',
          payload: { branchId: 'br_1', id: 'char_1' },
        },
        actionId: 'act_p1',
        branchId: 'br_1',
      },
      ctx,
    )
    const second = await applyDeltaAction(
      {
        action: {
          kind: 'promoteStagedEntity',
          source: 'ai_classifier',
          payload: { branchId: 'br_1', id: 'char_1' },
        },
        actionId: 'act_p2',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(second).toEqual({ status: 'rejected', reason: 'not-staged', code: 'noop' })
    const rows = await db.select().from(entities).where(eq(entities.id, 'char_1'))
    expect(rows).toHaveLength(1)
  })

  it('verifies two truly interleaved promoteStagedEntity dispatches land one ok and one soft rejected (no-op), leaving entity active', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createEntity', source: 'user_edit', payload: { entry: CHAR } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    // Promise.all, not sequential awaits: both dispatches start before either
    // finishes, so their loadCurrent reads can race against each other's
    // write — the actual TOCTOU window the monotonic-overlap invariant
    // (cadence.md → Concurrency) guards against.
    const [res1, res2] = await Promise.all([
      applyDeltaAction(
        {
          action: {
            kind: 'promoteStagedEntity',
            source: 'ai_classifier',
            payload: { branchId: 'br_1', id: 'char_1' },
          },
          actionId: 'act_p1',
          branchId: 'br_1',
        },
        ctx,
      ),
      applyDeltaAction(
        {
          action: {
            kind: 'promoteStagedEntity',
            source: 'ai_classifier',
            payload: { branchId: 'br_1', id: 'char_1' },
          },
          actionId: 'act_p2',
          branchId: 'br_1',
        },
        ctx,
      ),
    ])

    const results = [res1, res2]
    const oks = results.filter((r) => r.status === 'ok')
    const rejects = results.filter((r) => r.status === 'rejected')
    expect(oks).toHaveLength(1)
    expect(rejects).toEqual([{ status: 'rejected', reason: 'not-staged', code: 'noop' }])

    const row = await rowFor(db, 'char_1')
    expect(row.status).toBe('active')
    expect(entitiesStore.getById('char_1')?.status).toBe('active')
  })
})
