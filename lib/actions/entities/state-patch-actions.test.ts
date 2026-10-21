import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import {
  branches,
  deltas,
  entities,
  entityStateSchemaForKind,
  stories,
  type CharacterState,
  type Entity,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entitiesStore } from '@/lib/stores'
import { collisionPairOf, entityDeleteActions, entityMergeActions } from '@/lib/world'

import { registerEntities } from './register'
import { applyDeltaAction, applyDeltaActionGroup, lockKeysFor } from '../delta/apply-delta-action'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'
import { USER_EDITED_SINCE_PROSE } from '../delta/user-precedence'
import { updateStoryEntryContent } from '../story-entries/operational'
import { registerStoryEntries } from '../story-entries/register'
import type { PipelineAction } from '../types'

async function setup() {
  __resetRegistry()
  registerEntities()
  registerStoryEntries()
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

// Spelled out, not taken from emptyEntityState: the null-column fill under test calls it.
const NO_CHARACTER_STATE = {
  visual: {},
  traits: [],
  drives: [],
  current_location_id: null,
  equipped_items: [],
  inventory: [],
  faction_id: null,
  lastSeenAt: null,
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

describe('updateItemPosition', () => {
  const ROPE: NewEntity = {
    ...CHAR,
    id: 'item_rope',
    kind: 'item',
    name: 'Rope',
    state: { at_location_id: 'loc_hollow' },
  }

  it("sets an item's position, leaving its other state keys", async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'createEntity',
          source: 'user_edit',
          payload: {
            entry: { ...ROPE, state: { at_location_id: 'loc_hollow', condition: 'frayed' } },
          },
        },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    const result = await applyDeltaAction(
      {
        action: {
          kind: 'updateItemPosition',
          source: 'ai_classifier',
          payload: { branchId: 'br_1', id: 'item_rope', atLocationId: null },
        },
        actionId: 'act_p',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('ok')
    expect((await rowFor(db, 'item_rope')).state).toEqual({
      at_location_id: null,
      condition: 'frayed',
    })
  })

  it('refuses a target that is not an item', async () => {
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
          kind: 'updateItemPosition',
          source: 'ai_classifier',
          payload: { branchId: 'br_1', id: 'char_1', atLocationId: null },
        },
        actionId: 'act_p',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect((await rowFor(db, 'char_1')).state).not.toHaveProperty('at_location_id')
  })
})

// The patch builder merges unparsed, so only the arm stands between these fields and an item.
describe('character-only state arms', () => {
  const ROPE: NewEntity = {
    ...CHAR,
    id: 'item_rope',
    kind: 'item',
    name: 'Rope',
    state: { at_location_id: 'loc_hollow' },
  }

  it.each([
    { kind: 'updateEntityVisualState', visual: { attire: 'tarred' } },
    { kind: 'updateEntityInventory', inventory: ['item_knife'] },
    { kind: 'updateEntityStackables', stackables: { knots: 3 } },
    { kind: 'updateEntityLocationTracking', currentLocationId: 'loc_cellar' },
  ] as const)('$kind refuses an item target, writing nothing', async ({ kind, ...fields }) => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createEntity', source: 'user_edit', payload: { entry: ROPE } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    const result = await applyDeltaAction(
      {
        action: {
          kind,
          source: 'ai_classifier',
          payload: { branchId: 'br_1', id: 'item_rope', ...fields },
        } as PipelineAction,
        actionId: 'act_p',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect((await rowFor(db, 'item_rope')).state).toEqual({ at_location_id: 'loc_hollow' })
  })
})

describe('a null state column', () => {
  it('reads as the empty state for a per-turn state patch', async () => {
    const { db, ctx } = await setup()
    await apply(
      ctx,
      { kind: 'createEntity', source: 'user_edit', payload: { entry: CHAR } },
      'act_c',
    )
    await db.update(entities).set({ state: null }).where(eq(entities.id, 'char_1'))
    const result = await apply(
      ctx,
      {
        kind: 'updateEntityInventory',
        source: 'piggyback_tagged_block',
        payload: { branchId: 'br_1', id: 'char_1', inventory: ['item_rope'] },
      },
      'act_i',
    )
    expect(result.status).toBe('ok')
    const { state } = await rowFor(db, 'char_1')
    expect(state).toEqual({ ...NO_CHARACTER_STATE, inventory: ['item_rope'] })
    expect(entityStateSchemaForKind('character').safeParse(state).success).toBe(true)
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
          payload: { branchId: 'br_1', id: 'char_1', proseEntryId: null },
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
          payload: { branchId: 'br_1', id: 'char_1', proseEntryId: null },
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
          payload: { branchId: 'br_1', id: 'char_1', proseEntryId: null },
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
            payload: { branchId: 'br_1', id: 'char_1', proseEntryId: null },
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
            payload: { branchId: 'br_1', id: 'char_1', proseEntryId: null },
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
            payload: { branchId: 'br_1', id: 'char_1', proseEntryId: null },
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

const create = (ctx: Ctx, entry: NewEntity) =>
  apply(ctx, { kind: 'createEntity', source: 'user_edit', payload: { entry } }, 'act_c')

const userPatch = (patch: Record<string, unknown>): PipelineAction => ({
  kind: 'updateEntity',
  source: 'user_edit',
  payload: { branchId: 'br_1', id: 'char_1', patch },
})

describe('appendEntityKeywords', () => {
  const append = (keywords: string[]): PipelineAction => ({
    kind: 'appendEntityKeywords',
    source: 'periodic_classifier',
    payload: { branchId: 'br_1', id: 'char_1', keywords, proseEntryId: null },
  })

  it('appends only what the live row lacks, keeping an alias the user added before the pass', async () => {
    const { db, ctx } = await setup()
    await create(ctx, { ...CHAR, keywords: ['the knight'] })
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

  it('extends the live list, so an alias removed before the pass stays out when the payload omits it', async () => {
    const { db, ctx } = await setup()
    await create(ctx, { ...CHAR, keywords: ['the knight', 'the drunk'] })
    expect((await apply(ctx, userPatch({ keywords: ['the knight'] }), 'act_u')).status).toBe('ok')
    await apply(ctx, append(['the wanderer']), 'act_k')
    expect((await rowFor(db, 'char_1')).keywords).toEqual(['the knight', 'the wanderer'])
  })

  it('no-ops when every term is already held', async () => {
    const { ctx } = await setup()
    await create(ctx, { ...CHAR, keywords: ['the knight'] })
    expect(await apply(ctx, append([' THE KNIGHT ']), 'act_k')).toEqual({
      status: 'rejected',
      reason: 'no-new-keywords',
      code: 'noop',
    })
  })

  it('reverses to the list it extended', async () => {
    const { db, ctx } = await setup()
    await create(ctx, { ...CHAR, keywords: ['the knight'] })
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
    await create(ctx, { ...CHAR, keywords: ['the knight'] })
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
    payload: { branchId: 'br_1', id: 'char_1', retiredReason, proseEntryId: null },
  })
  const ACTIVE = { ...CHAR, status: 'active' as const }

  it('retires an active entity with its reason', async () => {
    const { db, ctx } = await setup()
    await create(ctx, ACTIVE)
    expect((await apply(ctx, retire('fell at the ford'), 'act_r')).status).toBe('ok')
    const row = await rowFor(db, 'char_1')
    expect(row.status).toBe('retired')
    expect(row.retiredReason).toBe('fell at the ford')
    expect(entitiesStore.getById('char_1')?.status).toBe('retired')
    expect(entitiesStore.getById('char_1')?.retiredReason).toBe('fell at the ford')
  })

  it('clears a leftover retiredReason when retiring with no reason given', async () => {
    const { db, ctx } = await setup()
    await create(ctx, { ...ACTIVE, retiredReason: 'old' })
    expect((await apply(ctx, retire(null), 'act_r')).status).toBe('ok')
    expect((await rowFor(db, 'char_1')).retiredReason).toBeNull()
  })

  it("no-ops on a row the user retired before the pass, keeping the user's reason", async () => {
    const { db, ctx } = await setup()
    await create(ctx, ACTIVE)
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

  // classifier.md → What the classifier writes: checked again when the write lands.
  it('no-ops on a location', async () => {
    const { db, ctx } = await setup()
    await create(ctx, {
      ...CHAR,
      kind: 'location',
      name: 'The Rusty Anchor',
      status: 'active',
      state: { parent_location_id: null },
    })
    expect(await apply(ctx, retire('burned down'), 'act_r')).toEqual({
      status: 'rejected',
      reason: 'location',
      code: 'noop',
    })
    expect((await rowFor(db, 'char_1')).status).toBe('active')
  })

  it('no-ops on a staged row', async () => {
    const { ctx } = await setup()
    await create(ctx, CHAR)
    expect(await apply(ctx, retire(null), 'act_r')).toEqual({
      status: 'rejected',
      reason: 'not-active',
      code: 'noop',
    })
  })

  it('reverses to the prior status and reason', async () => {
    const { db, ctx } = await setup()
    await create(ctx, ACTIVE)
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

// cadence.md → User edits and classifier writes: user edits after the prose win.
describe('user edits newer than the prose', () => {
  const PROSE = 'e_prose'
  const writeProse = (ctx: Ctx) =>
    apply(
      ctx,
      {
        kind: 'createStoryEntry',
        source: 'ai_classifier',
        payload: {
          entry: {
            id: PROSE,
            branchId: 'br_1',
            position: 1,
            kind: 'ai_reply',
            content: 'Kael fell at the ford.',
            createdAt: 1,
          },
        },
      },
      'act_prose',
    )
  const retire: PipelineAction = {
    kind: 'retireEntity',
    source: 'periodic_classifier',
    payload: { branchId: 'br_1', id: 'char_1', retiredReason: 'fell', proseEntryId: PROSE },
  }
  const promote: PipelineAction = {
    kind: 'promoteStagedEntity',
    source: 'periodic_classifier',
    payload: { branchId: 'br_1', id: 'char_1', proseEntryId: PROSE },
  }
  const append = (keywords: string[]): PipelineAction => ({
    kind: 'appendEntityKeywords',
    source: 'periodic_classifier',
    payload: { branchId: 'br_1', id: 'char_1', keywords, proseEntryId: PROSE },
  })
  const RETIRED = { ...CHAR, status: 'retired' as const, retiredReason: 'lost' }
  const userWon = { status: 'rejected', reason: USER_EDITED_SINCE_PROSE, code: 'noop' }

  it('keeps a revive the user made after the prose', async () => {
    const { db, ctx } = await setup()
    await create(ctx, RETIRED)
    await writeProse(ctx)
    await apply(ctx, userPatch({ status: 'active' }), 'act_u')
    expect(await apply(ctx, retire, 'act_r')).toEqual(userWon)
    expect((await rowFor(db, 'char_1')).status).toBe('active')
  })

  it('retires over a revive the user made before the prose', async () => {
    const { db, ctx } = await setup()
    await create(ctx, RETIRED)
    await apply(ctx, userPatch({ status: 'active' }), 'act_u')
    await writeProse(ctx)
    expect((await apply(ctx, retire, 'act_r')).status).toBe('ok')
    expect((await rowFor(db, 'char_1')).status).toBe('retired')
  })

  it('retires once a content edit makes the prose newer than the revive', async () => {
    const { db, ctx } = await setup()
    await create(ctx, RETIRED)
    await writeProse(ctx)
    await apply(ctx, userPatch({ status: 'active' }), 'act_u')
    expect(await updateStoryEntryContent('br_1', PROSE, 'Kael drowned at the ford.', ctx)).toEqual({
      status: 'ok',
    })
    expect((await apply(ctx, retire, 'act_r')).status).toBe('ok')
    expect((await rowFor(db, 'char_1')).status).toBe('retired')
  })

  it('keeps a status the user set after the prose on a row still staged', async () => {
    const { db, ctx } = await setup()
    await create(ctx, { ...CHAR, status: 'active' })
    await writeProse(ctx)
    await apply(ctx, userPatch({ status: 'staged' }), 'act_u')
    expect(await apply(ctx, promote, 'act_p')).toEqual(userWon)
    expect((await rowFor(db, 'char_1')).status).toBe('staged')
  })

  it('promotes past a user edit after the prose that left status alone', async () => {
    const { db, ctx } = await setup()
    await create(ctx, CHAR)
    await writeProse(ctx)
    await apply(ctx, userPatch({ description: 'a knight errant' }), 'act_u')
    expect((await apply(ctx, promote, 'act_p')).status).toBe('ok')
    expect((await rowFor(db, 'char_1')).status).toBe('active')
  })

  it('drops an alias the user removed after the prose and appends the rest', async () => {
    const { db, ctx } = await setup()
    await create(ctx, { ...CHAR, keywords: ['the knight', 'the drunk'] })
    await writeProse(ctx)
    await apply(ctx, userPatch({ keywords: ['the knight'] }), 'act_u')
    expect((await apply(ctx, append(['The Drunk', 'the wanderer']), 'act_k')).status).toBe('ok')
    expect((await rowFor(db, 'char_1')).keywords).toEqual(['the knight', 'the wanderer'])
  })

  it('no-ops when every new alias is one the user removed after the prose', async () => {
    const { db, ctx } = await setup()
    await create(ctx, { ...CHAR, keywords: ['the knight', 'the drunk'] })
    await writeProse(ctx)
    await apply(ctx, userPatch({ keywords: ['the knight'] }), 'act_u')
    expect(await apply(ctx, append(['the drunk']), 'act_k')).toEqual(userWon)
    expect((await rowFor(db, 'char_1')).keywords).toEqual(['the knight'])
  })

  it('keeps the status of an entity the user created after the prose', async () => {
    const { db, ctx } = await setup()
    await writeProse(ctx)
    await create(ctx, { ...CHAR, status: 'active' })
    expect(await apply(ctx, retire, 'act_r')).toEqual(userWon)
    expect((await rowFor(db, 'char_1')).status).toBe('active')
  })

  it('retires once the user undoes the status edits made after the prose', async () => {
    const { db, ctx } = await setup()
    await create(ctx, { ...CHAR, status: 'active' })
    await writeProse(ctx)
    await apply(ctx, userPatch({ status: 'retired', retiredReason: 'exiled' }), 'act_u1')
    await apply(ctx, userPatch({ status: 'active' }), 'act_u2')
    expect(await apply(ctx, retire, 'act_r1')).toEqual(userWon)
    await reverseReplayDeltas('act_u2', ctx)
    await reverseReplayDeltas('act_u1', ctx)
    expect((await apply(ctx, retire, 'act_r2')).status).toBe('ok')
    expect((await rowFor(db, 'char_1')).status).toBe('retired')
  })

  it("matches a removed alias under normalizeTerm, whatever the user's spelling", async () => {
    const { db, ctx } = await setup()
    await create(ctx, { ...CHAR, keywords: ['the knight', 'The Drunk'] })
    await writeProse(ctx)
    await apply(ctx, userPatch({ keywords: ['the knight'] }), 'act_u')
    expect((await apply(ctx, append(['the drunk', 'the wanderer']), 'act_k')).status).toBe('ok')
    expect((await rowFor(db, 'char_1')).keywords).toEqual(['the knight', 'the wanderer'])
  })

  it('restores an alias the user removed before the prose', async () => {
    const { db, ctx } = await setup()
    await create(ctx, { ...CHAR, keywords: ['the knight', 'the drunk'] })
    await apply(ctx, userPatch({ keywords: ['the knight'] }), 'act_u')
    await writeProse(ctx)
    expect((await apply(ctx, append(['The Drunk', 'the wanderer']), 'act_k')).status).toBe('ok')
    expect((await rowFor(db, 'char_1')).keywords).toEqual([
      'the knight',
      'The Drunk',
      'the wanderer',
    ])
  })
})

describe('setCharacterFaction', () => {
  const PROSE = 'e_prose'
  const writeProse = (ctx: Ctx) =>
    apply(
      ctx,
      {
        kind: 'createStoryEntry',
        source: 'ai_classifier',
        payload: {
          entry: {
            id: PROSE,
            branchId: 'br_1',
            position: 1,
            kind: 'ai_reply',
            content: 'Kael swore to the Iron Circle.',
            createdAt: 1,
          },
        },
      },
      'act_prose',
    )
  const faction = (id: string, over: Partial<NewEntity> = {}): NewEntity => ({
    id,
    branchId: 'br_1',
    kind: 'faction',
    name: id,
    status: 'active',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  })
  const ACTIVE = { ...CHAR, status: 'active' as const }
  const join = (
    factionId: string | null,
    { id = 'char_1', proseEntryId = PROSE }: { id?: string; proseEntryId?: string | null } = {},
  ): PipelineAction => ({
    kind: 'setCharacterFaction',
    source: 'periodic_classifier',
    payload: { branchId: 'br_1', id, factionId, proseEntryId },
  })
  const noop = (reason: string) => ({ status: 'rejected', reason, code: 'noop' })
  const userWon = noop(USER_EDITED_SINCE_PROSE)

  async function seedRows(ctx: Ctx, db: Db, character: NewEntity = ACTIVE) {
    await db.insert(entities).values([faction('fact_circle'), faction('fact_crown')])
    await create(ctx, character)
  }

  async function seed(ctx: Ctx, db: Db, character: NewEntity = ACTIVE) {
    await seedRows(ctx, db, character)
    await writeProse(ctx)
  }

  const factionOf = async (db: Db, id = 'char_1') =>
    ((await rowFor(db, id)).state as CharacterState).faction_id

  type Db = Awaited<ReturnType<typeof setup>>['db']

  it('writes the faction alone, so its undo payload holds only that field', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    expect((await apply(ctx, join('fact_circle'), 'act_j')).status).toBe('ok')

    expect((await rowFor(db, 'char_1')).state).toEqual({ ...CHAR.state, faction_id: 'fact_circle' })
    expect((entitiesStore.getById('char_1')?.state as CharacterState | undefined)?.faction_id).toBe(
      'fact_circle',
    )
    const [delta] = await db.select().from(deltas).where(eq(deltas.actionId, 'act_j'))
    expect(delta.undoPayload).toEqual({ state: { faction_id: null } })
  })

  it('clears a faction to none', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db, { ...ACTIVE, state: { ...CHAR.state, faction_id: 'fact_circle' } as never })
    expect((await apply(ctx, join(null), 'act_j')).status).toBe('ok')
    expect(await factionOf(db)).toBeNull()
  })

  it('writes onto a character whose state column is null', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    await db.update(entities).set({ state: null }).where(eq(entities.id, 'char_1'))
    expect((await apply(ctx, join('fact_circle'), 'act_j')).status).toBe('ok')
    const { state } = await rowFor(db, 'char_1')
    expect(state).toEqual({ ...NO_CHARACTER_STATE, faction_id: 'fact_circle' })
    expect(entityStateSchemaForKind('character').safeParse(state).success).toBe(true)
  })

  it('no-ops on a row that is gone', async () => {
    const { ctx, db } = await setup()
    await seed(ctx, db)
    expect(await apply(ctx, join('fact_circle', { id: 'char_gone' }), 'act_j')).toMatchObject({
      status: 'rejected',
      code: 'noop',
    })
  })

  it('no-ops on a row that is not a character', async () => {
    const { ctx, db } = await setup()
    await seed(ctx, db)
    expect(await apply(ctx, join('fact_circle', { id: 'fact_crown' }), 'act_j')).toEqual(
      noop('not-a-character'),
    )
  })

  it('no-ops when the faction already matches', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db, { ...ACTIVE, state: { ...CHAR.state, faction_id: 'fact_circle' } as never })
    expect(await apply(ctx, join('fact_circle'), 'act_j')).toEqual(noop('faction-unchanged'))
  })

  it.each([
    ['names no row', 'fact_gone'],
    ['names a character', 'char_2'],
  ])('no-ops on a faction that %s', async (_label, factionId) => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    await db.insert(entities).values({ ...ACTIVE, id: 'char_2' })
    expect(await apply(ctx, join(factionId), 'act_j')).toEqual(noop('not-a-faction'))
    expect(await factionOf(db)).toBeNull()
  })

  it('no-ops on a faction that exists only on another branch', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    await db.insert(branches).values({ id: 'br_2', storyId: 'story_1', name: 'alt', createdAt: 1 })
    await db.insert(entities).values(faction('fact_elsewhere', { branchId: 'br_2' }))
    expect(await apply(ctx, join('fact_elsewhere'), 'act_j')).toEqual(noop('not-a-faction'))
    expect(await factionOf(db)).toBeNull()
  })

  it('takes a faction the same group creates', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    const result = await applyDeltaActionGroup(
      [
        join('fact_new'),
        {
          kind: 'createEntity',
          source: 'periodic_classifier',
          payload: { entry: faction('fact_new') },
        },
      ],
      { actionId: 'act_g', branchId: 'br_1' },
      ctx,
    )
    expect(result).toEqual({ status: 'ok' })
    expect(await factionOf(db)).toBe('fact_new')
  })

  it('keeps a faction the user set after the prose', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    await apply(ctx, userPatch({ state: { ...CHAR.state, faction_id: 'fact_crown' } }), 'act_u')
    expect(await apply(ctx, join('fact_circle'), 'act_j')).toEqual(userWon)
    expect(await factionOf(db)).toBe('fact_crown')
  })

  it("writes past a later edit of the character's traits", async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    await apply(ctx, userPatch({ state: { ...CHAR.state, traits: ['brave', 'stern'] } }), 'act_u')
    expect((await apply(ctx, join('fact_circle'), 'act_j')).status).toBe('ok')
    expect(await factionOf(db)).toBe('fact_circle')
  })

  it('writes over a faction the user set before the prose', async () => {
    const { db, ctx } = await setup()
    await seedRows(ctx, db)
    await apply(ctx, userPatch({ state: { ...CHAR.state, faction_id: 'fact_crown' } }), 'act_u')
    await writeProse(ctx)
    expect((await apply(ctx, join('fact_circle'), 'act_j')).status).toBe('ok')
    expect(await factionOf(db)).toBe('fact_circle')
  })

  it('keeps the faction of a character the user created after the prose', async () => {
    const { db, ctx } = await setup()
    await writeProse(ctx)
    await seedRows(ctx, db)
    expect(await apply(ctx, join('fact_circle'), 'act_j')).toEqual(userWon)
  })

  async function rows(db: Db): Promise<Entity[]> {
    return (await db.select().from(entities).where(eq(entities.branchId, 'br_1'))) as Entity[]
  }

  it('treats a World delete re-pointing the faction as a user write to it', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db, { ...ACTIVE, state: { ...CHAR.state, faction_id: 'fact_crown' } as never })
    const branchEntities = await rows(db)
    const target = branchEntities.find((e) => e.id === 'fact_crown')!
    const { actions } = entityDeleteActions({
      branchId: 'br_1',
      target,
      branchEntities,
      tail: null,
    })
    expect(
      await applyDeltaActionGroup(actions, { actionId: 'act_d', branchId: 'br_1' }, ctx),
    ).toEqual({
      status: 'ok',
    })

    expect(await apply(ctx, join('fact_circle'), 'act_j')).toEqual(userWon)
    expect(await factionOf(db)).toBeNull()
  })

  it('treats a merge re-pointing the faction as a user write to it', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values([
      faction('fact_circle'),
      faction('fact_crown'),
      faction('fact_crown_2', {
        nameCollisionFlag: 1,
        nameCollisionPartnerId: 'fact_crown',
        nameCollisionReason: 'alike',
      }),
    ])
    await create(ctx, { ...ACTIVE, state: { ...CHAR.state, faction_id: 'fact_crown_2' } as never })
    await writeProse(ctx)
    const branchEntities = await rows(db)
    const lookup = collisionPairOf(branchEntities, ['fact_crown', 'fact_crown_2'])
    if ('miss' in lookup) throw new Error(lookup.miss)
    const actions = entityMergeActions({
      branchId: 'br_1',
      pair: lookup.pair,
      canonicalId: 'fact_crown',
      fromLoser: [],
      deselectedTags: [],
      deselectedKeywords: [],
      branchEntities,
      happenings: [],
      awareness: [],
      involvements: [],
      relationships: [],
      tail: null,
      newId: (prefix) => `${prefix}_merge`,
    })
    expect(
      await applyDeltaActionGroup(actions, { actionId: 'act_m', branchId: 'br_1' }, ctx),
    ).toEqual({
      status: 'ok',
    })
    expect(await factionOf(db)).toBe('fact_crown')

    expect(await apply(ctx, join('fact_circle'), 'act_j')).toEqual(userWon)
    expect(await factionOf(db)).toBe('fact_crown')
  })

  it("serializes on the character's row key", () => {
    expect(lockKeysFor(join('fact_circle'))).toEqual(['entities:br_1:char_1'])
  })
})
