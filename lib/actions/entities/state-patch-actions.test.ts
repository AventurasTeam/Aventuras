import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, entities, stories, type NewEntity } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entitiesStore } from '@/lib/stores'

import { registerEntities } from './register'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'
import type { PipelineAction } from '../types'

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

  it('no-ops when the target row is gone, same as any other row the pass read stale', async () => {
    const { ctx } = await setup()
    expect(
      await applyDeltaAction(
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
      ),
    ).toEqual({
      status: 'rejected',
      reason: 'promote target entities br_1:char_1 not found',
      code: 'noop',
    })
  })
})

type Ctx = Awaited<ReturnType<typeof setup>>['ctx']

const apply = (ctx: Ctx, action: PipelineAction, actionId: string) =>
  applyDeltaAction({ action, actionId, branchId: 'br_1' }, ctx)

const userPatch = (patch: Record<string, unknown>): PipelineAction => ({
  kind: 'updateEntity',
  source: 'user_edit',
  payload: { branchId: 'br_1', id: 'char_1', patch },
})

describe('appendEntityKeywords', () => {
  const append = (keywords: string[]): PipelineAction => ({
    kind: 'appendEntityKeywords',
    source: 'periodic_classifier',
    payload: { branchId: 'br_1', id: 'char_1', keywords },
  })

  it('appends only what the live row lacks, keeping an alias the user added mid-pass', async () => {
    const { db, ctx } = await setup()
    await apply(
      ctx,
      {
        kind: 'createEntity',
        source: 'user_edit',
        payload: { entry: { ...CHAR, keywords: ['the knight'] } },
      },
      'act_c',
    )
    expect(
      (await apply(ctx, userPatch({ keywords: ['the knight', 'ser kael'] }), 'act_u')).status,
    ).toBe('ok')
    const result = await apply(ctx, append(['The Knight', 'the wanderer']), 'act_k')
    expect(result.status).toBe('ok')
    expect((await rowFor(db, 'char_1')).keywords).toEqual([
      'the knight',
      'ser kael',
      'the wanderer',
    ])
    expect(entitiesStore.getById('char_1')?.keywords).toEqual([
      'the knight',
      'ser kael',
      'the wanderer',
    ])
  })

  it('extends the live list, so an alias removed mid-pass stays out when the payload omits it', async () => {
    const { db, ctx } = await setup()
    await apply(
      ctx,
      {
        kind: 'createEntity',
        source: 'user_edit',
        payload: { entry: { ...CHAR, keywords: ['the knight', 'the drunk'] } },
      },
      'act_c',
    )
    expect((await apply(ctx, userPatch({ keywords: ['the knight'] }), 'act_u')).status).toBe('ok')
    await apply(ctx, append(['the wanderer']), 'act_k')
    expect((await rowFor(db, 'char_1')).keywords).toEqual(['the knight', 'the wanderer'])
  })

  it('no-ops when every term is already held', async () => {
    const { ctx } = await setup()
    await apply(
      ctx,
      {
        kind: 'createEntity',
        source: 'user_edit',
        payload: { entry: { ...CHAR, keywords: ['the knight'] } },
      },
      'act_c',
    )
    expect(await apply(ctx, append([' THE KNIGHT ']), 'act_k')).toEqual({
      status: 'rejected',
      reason: 'no-new-keywords',
      code: 'noop',
    })
  })

  it('reverses to the list it extended', async () => {
    const { db, ctx } = await setup()
    await apply(
      ctx,
      {
        kind: 'createEntity',
        source: 'user_edit',
        payload: { entry: { ...CHAR, keywords: ['the knight'] } },
      },
      'act_c',
    )
    await apply(ctx, append(['the wanderer']), 'act_k')
    expect(await reverseReplayDeltas('act_k', ctx)).toBe(1)
    expect((await rowFor(db, 'char_1')).keywords).toEqual(['the knight'])
  })

  it('no-ops when the target row is gone, same as any other row the pass read stale', async () => {
    const { ctx } = await setup()
    expect(await apply(ctx, append(['the wanderer']), 'act_k')).toEqual({
      status: 'rejected',
      reason: 'keyword target entities br_1:char_1 not found',
      code: 'noop',
    })
  })

  it('serializes two concurrent appends onto the same row: both land, in either order', async () => {
    const { db, ctx } = await setup()
    await apply(
      ctx,
      {
        kind: 'createEntity',
        source: 'user_edit',
        payload: { entry: { ...CHAR, keywords: ['the knight'] } },
      },
      'act_c',
    )
    await Promise.all([
      apply(ctx, append(['the wanderer']), 'act_k1'),
      apply(ctx, append(['the drunk']), 'act_k2'),
    ])
    expect((await rowFor(db, 'char_1')).keywords.slice().sort()).toEqual(
      ['the drunk', 'the knight', 'the wanderer'].sort(),
    )
  })
})

describe('retireEntity', () => {
  const retire = (retiredReason: string | null): PipelineAction => ({
    kind: 'retireEntity',
    source: 'periodic_classifier',
    payload: { branchId: 'br_1', id: 'char_1', retiredReason },
  })
  const ACTIVE = { ...CHAR, status: 'active' as const }

  it('retires an active entity with its reason', async () => {
    const { db, ctx } = await setup()
    await apply(
      ctx,
      { kind: 'createEntity', source: 'user_edit', payload: { entry: ACTIVE } },
      'act_c',
    )
    expect((await apply(ctx, retire('fell at the ford'), 'act_r')).status).toBe('ok')
    const row = await rowFor(db, 'char_1')
    expect(row.status).toBe('retired')
    expect(row.retiredReason).toBe('fell at the ford')
    expect(entitiesStore.getById('char_1')?.status).toBe('retired')
    expect(entitiesStore.getById('char_1')?.retiredReason).toBe('fell at the ford')
  })

  it('clears a leftover retiredReason when retiring with no reason given', async () => {
    const { db, ctx } = await setup()
    await apply(
      ctx,
      {
        kind: 'createEntity',
        source: 'user_edit',
        payload: { entry: { ...ACTIVE, retiredReason: 'old' } },
      },
      'act_c',
    )
    expect((await apply(ctx, retire(null), 'act_r')).status).toBe('ok')
    expect((await rowFor(db, 'char_1')).retiredReason).toBeNull()
  })

  it("no-ops on a row the user retired mid-pass, keeping the user's reason", async () => {
    const { db, ctx } = await setup()
    await apply(
      ctx,
      { kind: 'createEntity', source: 'user_edit', payload: { entry: ACTIVE } },
      'act_c',
    )
    expect(
      (await apply(ctx, userPatch({ status: 'retired', retiredReason: 'exiled' }), 'act_u')).status,
    ).toBe('ok')
    expect(await apply(ctx, retire('fell at the ford'), 'act_r')).toEqual({
      status: 'rejected',
      reason: 'not-active',
      code: 'noop',
    })
    expect((await rowFor(db, 'char_1')).retiredReason).toBe('exiled')
  })

  it('no-ops on a staged row', async () => {
    const { ctx } = await setup()
    await apply(
      ctx,
      { kind: 'createEntity', source: 'user_edit', payload: { entry: CHAR } },
      'act_c',
    )
    expect(await apply(ctx, retire(null), 'act_r')).toEqual({
      status: 'rejected',
      reason: 'not-active',
      code: 'noop',
    })
  })

  it('reverses to the prior status and reason', async () => {
    const { db, ctx } = await setup()
    await apply(
      ctx,
      { kind: 'createEntity', source: 'user_edit', payload: { entry: ACTIVE } },
      'act_c',
    )
    await apply(ctx, retire('fell at the ford'), 'act_r')
    expect(await reverseReplayDeltas('act_r', ctx)).toBe(1)
    const row = await rowFor(db, 'char_1')
    expect(row.status).toBe('active')
    expect(row.retiredReason).toBeNull()
  })

  it('no-ops when the target row is gone, same as any other row the pass read stale', async () => {
    const { ctx } = await setup()
    expect(await apply(ctx, retire('fell at the ford'), 'act_r')).toEqual({
      status: 'rejected',
      reason: 'retire target entities br_1:char_1 not found',
      code: 'noop',
    })
  })
})
