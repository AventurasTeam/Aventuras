import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import {
  branches,
  deltas,
  entities,
  entityStateSchemaForKind,
  stories,
  storyEntries,
  type CharacterState,
  type CollisionReason,
  type Entity,
  type LocationState,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  __resetDiagnosticsGate,
  clearBuffers,
  configureDiagnosticsGate,
  getDiagnosticsSnapshot,
} from '@/lib/diagnostics'
import { entitiesStore } from '@/lib/stores'
import { collisionPairOf, entityDeleteActions, entityMergeActions, storyPlaceOf } from '@/lib/world'

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

type Ctx = Awaited<ReturnType<typeof setup>>['ctx']
type StateDb = Awaited<ReturnType<typeof setup>>['db']

async function rowFor(db: StateDb, id: string) {
  const [r] = await db.select().from(entities).where(eq(entities.id, id))
  return r
}

const apply = (ctx: Ctx, action: PipelineAction, actionId: string) =>
  applyDeltaAction({ action, actionId, branchId: 'br_1' }, ctx)

const create = (ctx: Ctx, entry: NewEntity) =>
  apply(ctx, { kind: 'createEntity', source: 'user_edit', payload: { entry } }, 'act_c')

const userPatch = (patch: Record<string, unknown>): PipelineAction => ({
  kind: 'updateEntity',
  source: 'user_edit',
  payload: { branchId: 'br_1', id: 'char_1', patch },
})

// cadence.md → User edits and classifier writes: the entry a pass's write rests on.
const writeProseEntry = (ctx: Ctx, id: string, content: string) =>
  apply(
    ctx,
    {
      kind: 'createStoryEntry',
      source: 'ai_classifier',
      payload: {
        entry: { id, branchId: 'br_1', position: 1, kind: 'ai_reply', content, createdAt: 1 },
      },
    },
    'act_prose',
  )

const noopBecause = (reason: string) => ({ status: 'rejected', reason, code: 'noop' })
const userWonOver = noopBecause(USER_EDITED_SINCE_PROSE)

const undoPayloadsOf = async (db: StateDb, actionId: string) =>
  (await db.select().from(deltas).where(eq(deltas.actionId, actionId))).map((d) => d.undoPayload)
const undoPayloadOf = async (db: StateDb, actionId: string) =>
  (await undoPayloadsOf(db, actionId))[0]

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

  it('no-ops when the target row is gone', async () => {
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

  it('no-ops when the target row is gone', async () => {
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

  it('no-ops when the target row is gone', async () => {
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
  const writeProse = (ctx: Ctx) => writeProseEntry(ctx, PROSE, 'Kael fell at the ford.')
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

  it('keeps a revive the user made after the prose', async () => {
    const { db, ctx } = await setup()
    await create(ctx, RETIRED)
    await writeProse(ctx)
    await apply(ctx, userPatch({ status: 'active' }), 'act_u')
    expect(await apply(ctx, retire, 'act_r')).toEqual(userWonOver)
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
    expect(await apply(ctx, promote, 'act_p')).toEqual(userWonOver)
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
    expect(await apply(ctx, append(['the drunk']), 'act_k')).toEqual(userWonOver)
    expect((await rowFor(db, 'char_1')).keywords).toEqual(['the knight'])
  })

  it('keeps the status of an entity the user created after the prose', async () => {
    const { db, ctx } = await setup()
    await writeProse(ctx)
    await create(ctx, { ...CHAR, status: 'active' })
    expect(await apply(ctx, retire, 'act_r')).toEqual(userWonOver)
    expect((await rowFor(db, 'char_1')).status).toBe('active')
  })

  it('retires once the user undoes the status edits made after the prose', async () => {
    const { db, ctx } = await setup()
    await create(ctx, { ...CHAR, status: 'active' })
    await writeProse(ctx)
    await apply(ctx, userPatch({ status: 'retired', retiredReason: 'exiled' }), 'act_u1')
    await apply(ctx, userPatch({ status: 'active' }), 'act_u2')
    expect(await apply(ctx, retire, 'act_r1')).toEqual(userWonOver)
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
  const writeProse = (ctx: Ctx) => writeProseEntry(ctx, PROSE, 'Kael swore to the Iron Circle.')
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
  async function seedRows(ctx: Ctx, db: StateDb, character: NewEntity = ACTIVE) {
    await db.insert(entities).values([faction('fact_circle'), faction('fact_crown')])
    await create(ctx, character)
  }

  async function seed(ctx: Ctx, db: StateDb, character: NewEntity = ACTIVE) {
    await seedRows(ctx, db, character)
    await writeProse(ctx)
  }

  const factionOf = async (db: StateDb, id = 'char_1') =>
    ((await rowFor(db, id)).state as CharacterState).faction_id

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
      noopBecause('not-a-character'),
    )
  })

  it('no-ops when the faction already matches', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db, { ...ACTIVE, state: { ...CHAR.state, faction_id: 'fact_circle' } as never })
    expect(await apply(ctx, join('fact_circle'), 'act_j')).toEqual(noopBecause('faction-unchanged'))
  })

  it.each([
    ['names no row', 'fact_gone'],
    ['names a character', 'char_2'],
  ])('no-ops on a faction that %s', async (_label, factionId) => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    await db.insert(entities).values({ ...ACTIVE, id: 'char_2' })
    expect(await apply(ctx, join(factionId), 'act_j')).toEqual(noopBecause('not-a-faction'))
    expect(await factionOf(db)).toBeNull()
  })

  it('no-ops on a faction that exists only on another branch', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    await db.insert(branches).values({ id: 'br_2', storyId: 'story_1', name: 'alt', createdAt: 1 })
    await db.insert(entities).values(faction('fact_elsewhere', { branchId: 'br_2' }))
    expect(await apply(ctx, join('fact_elsewhere'), 'act_j')).toEqual(noopBecause('not-a-faction'))
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
    expect(await apply(ctx, join('fact_circle'), 'act_j')).toEqual(userWonOver)
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
    expect(await apply(ctx, join('fact_circle'), 'act_j')).toEqual(userWonOver)
  })

  async function rows(db: StateDb): Promise<Entity[]> {
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

    expect(await apply(ctx, join('fact_circle'), 'act_j')).toEqual(userWonOver)
    expect(await factionOf(db)).toBeNull()
  })

  it('treats a merge re-pointing the faction as a user write to it', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values([
      faction('fact_circle'),
      faction('fact_crown', { name: 'The Crown' }),
      faction('fact_crown_2', {
        name: 'The Crown',
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
      story: storyPlaceOf({ tail: null, sceneSource: null }),
      tail: null,
      newId: (prefix) => `${prefix}_merge`,
    })
    expect(
      await applyDeltaActionGroup(actions, { actionId: 'act_m', branchId: 'br_1' }, ctx),
    ).toEqual({
      status: 'ok',
    })
    expect(await factionOf(db)).toBe('fact_crown')

    expect(await apply(ctx, join('fact_circle'), 'act_j')).toEqual(userWonOver)
    expect(await factionOf(db)).toBe('fact_crown')
  })

  it("serializes on the character's row key", () => {
    expect(lockKeysFor(join('fact_circle'))).toEqual(['entities:br_1:char_1'])
  })
})

// data-model.md → LocationState shape: a place's parent and its unplaced flag are written as one.
describe('placeLocation', () => {
  const PROSE = 'e_prose'

  const placeRow = (
    id: string,
    state: LocationState,
    over: Partial<NewEntity> = {},
  ): NewEntity => ({
    id,
    branchId: 'br_1',
    kind: 'location',
    name: id,
    status: 'active',
    injectionMode: 'auto',
    state,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  })
  const UNPLACED: LocationState = { parent_location_id: null, unplaced: true, condition: 'flooded' }
  const place = (
    placement: { kind: 'under'; parentId: string } | { kind: 'top' },
    { id = 'loc_varn', proseEntryId = null }: { id?: string; proseEntryId?: string | null } = {},
  ): PipelineAction => ({
    kind: 'placeLocation',
    source: 'periodic_classifier',
    payload: { branchId: 'br_1', id, placement, proseEntryId },
  })
  const UNDER_REACH = { kind: 'under', parentId: 'loc_reach' } as const
  const TOP = { kind: 'top' } as const
  const userState = (state: LocationState): PipelineAction => ({
    kind: 'updateEntity',
    source: 'user_edit',
    payload: { branchId: 'br_1', id: 'loc_varn', patch: { state } },
  })
  const writeProse = (ctx: Ctx) =>
    writeProseEntry(ctx, PROSE, 'The road to Varn ran through the Eastern Reach.')

  // The neighbours go straight in; Varn goes through createEntity, so the store holds it too.
  async function seed(
    ctx: Ctx,
    db: StateDb,
    varn: LocationState = UNPLACED,
    others: NewEntity[] = [],
  ) {
    await db
      .insert(entities)
      .values([
        placeRow('loc_reach', { parent_location_id: null }),
        placeRow('loc_marsh', { parent_location_id: null }),
        ...others,
      ])
    await create(ctx, placeRow('loc_varn', varn))
  }

  const stateIn = async (db: StateDb, id = 'loc_varn') => (await rowFor(db, id)).state

  it('places an unplaced place under a parent: the flag leaves the row and the store', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    expect((await apply(ctx, place(UNDER_REACH), 'act_p')).status).toBe('ok')

    const placed = { parent_location_id: 'loc_reach', condition: 'flooded' }
    const stored = await stateIn(db)
    expect(stored).toEqual(placed)
    expect(Object.keys(stored ?? {})).not.toContain('unplaced')
    const inStore = entitiesStore.getById('loc_varn')?.state
    expect(inStore).toEqual(placed)
    expect(Object.keys(inStore ?? {})).not.toContain('unplaced')
    expect(await undoPayloadsOf(db, 'act_p')).toEqual([
      { state: { parent_location_id: null, unplaced: true } },
    ])
  })

  it('marks an unplaced place top-level, the flag gone', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    expect((await apply(ctx, place(TOP), 'act_p')).status).toBe('ok')

    const topLevel = { parent_location_id: null, condition: 'flooded' }
    const stored = await stateIn(db)
    expect(stored).toEqual(topLevel)
    expect(Object.keys(stored ?? {})).not.toContain('unplaced')
    const inStore = entitiesStore.getById('loc_varn')?.state
    expect(inStore).toEqual(topLevel)
    expect(Object.keys(inStore ?? {})).not.toContain('unplaced')
    expect(await undoPayloadsOf(db, 'act_p')).toEqual([{ state: { unplaced: true } }])
  })

  it('moves a placed place to another parent', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db, { parent_location_id: 'loc_reach' })
    expect(
      (await apply(ctx, place({ kind: 'under', parentId: 'loc_marsh' }), 'act_p')).status,
    ).toBe('ok')
    expect(await stateIn(db)).toEqual({ parent_location_id: 'loc_marsh' })
    expect(await undoPayloadsOf(db, 'act_p')).toEqual([
      { state: { parent_location_id: 'loc_reach' } },
    ])
  })

  it('reverses to the unplaced place it was, flag and all', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    await apply(ctx, place(UNDER_REACH), 'act_p')
    expect(await reverseReplayDeltas('act_p', ctx)).toBe(1)
    expect(await stateIn(db)).toEqual(UNPLACED)
    expect(entitiesStore.getById('loc_varn')?.state).toEqual(UNPLACED)
  })

  // location-map.ts reads a parent the branch has no place for as unplaced; so does the handler.
  it('marks a place whose stored parent names no place top-level', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db, { parent_location_id: 'loc_gone' })
    expect((await apply(ctx, place(TOP), 'act_p')).status).toBe('ok')
    expect(await stateIn(db)).toEqual({ parent_location_id: null })
  })

  describe('refusals, each a noop that leaves the row as it was', () => {
    async function expectRefused(
      ctx: Ctx,
      db: StateDb,
      action: PipelineAction,
      reason: string | RegExp,
      before: unknown = UNPLACED,
    ) {
      const result = await apply(ctx, action, 'act_p')
      expect(result).toMatchObject({ status: 'rejected', code: 'noop', reason })
      expect(await undoPayloadsOf(db, 'act_p')).toEqual([])
      if (before !== undefined) expect(await stateIn(db)).toEqual(before)
    }

    it('refuses a row that is gone, or is not a place', async () => {
      const { db, ctx } = await setup()
      await seed(ctx, db)
      await db.insert(entities).values({ ...CHAR, status: 'active' })
      await expectRefused(ctx, db, place(TOP, { id: 'loc_none' }), /not found/)
      await expectRefused(ctx, db, place(TOP, { id: 'char_1' }), 'not-a-location')
    })

    it('refuses the placement the place already has', async () => {
      const { db, ctx } = await setup()
      await seed(ctx, db, { parent_location_id: 'loc_reach' })
      await expectRefused(ctx, db, place(UNDER_REACH), 'placement-unchanged', {
        parent_location_id: 'loc_reach',
      })
    })

    it('refuses to mark a top-level place top-level', async () => {
      const { db, ctx } = await setup()
      await seed(ctx, db, { parent_location_id: null })
      await expectRefused(ctx, db, place(TOP), 'placement-unchanged', { parent_location_id: null })
    })

    // data-model.md → Authorship contract: only an unplaced place may be marked top-level.
    it('refuses to mark a placed place top-level', async () => {
      const { db, ctx } = await setup()
      await seed(ctx, db, { parent_location_id: 'loc_reach' })
      await expectRefused(ctx, db, place(TOP), 'not-unplaced', { parent_location_id: 'loc_reach' })
    })

    it('refuses a parent that is no place on the branch', async () => {
      const { db, ctx } = await setup()
      await db
        .insert(branches)
        .values({ id: 'br_2', storyId: 'story_1', name: 'alt', createdAt: 1 })
      await seed(ctx, db, UNPLACED, [
        { ...CHAR, id: 'char_2', status: 'active' },
        placeRow('loc_elsewhere', { parent_location_id: null }, { branchId: 'br_2' }),
      ])
      for (const parentId of ['loc_none', 'char_2', 'loc_elsewhere'])
        await expectRefused(ctx, db, place({ kind: 'under', parentId }), 'parent-not-a-place')
    })

    it('refuses a retired parent', async () => {
      const { db, ctx } = await setup()
      await seed(ctx, db, UNPLACED, [
        placeRow('loc_ruin', { parent_location_id: null }, { status: 'retired' }),
      ])
      await expectRefused(ctx, db, place({ kind: 'under', parentId: 'loc_ruin' }), 'retired-parent')
    })

    it('refuses a parent inside the place, or the place itself', async () => {
      const { db, ctx } = await setup()
      await seed(ctx, db, { parent_location_id: 'loc_reach' }, [
        placeRow('loc_docks', { parent_location_id: 'loc_varn' }),
      ])
      const before = { parent_location_id: 'loc_reach' }
      for (const parentId of ['loc_docks', 'loc_varn'])
        await expectRefused(ctx, db, place({ kind: 'under', parentId }), 'parent-cycle', before)
    })

    // data-model.md → Disabled places: a pass's move refuses where World's Save would.
    describe('a disabled place around the story', () => {
      const THORN = placeRow(
        'loc_thorn',
        { parent_location_id: null },
        { injectionMode: 'disabled' },
      )
      const CRYPT = placeRow('loc_crypt', { parent_location_id: 'loc_varn' })
      // The scene source names the crypt; a user_action tail standing after it names the marsh.
      async function storyIn(db: StateDb) {
        await db.insert(storyEntries).values([
          {
            id: 'e_reply',
            branchId: 'br_1',
            position: 1,
            kind: 'ai_reply',
            content: 'In the crypt.',
            metadata: { sceneEntities: [], currentLocationId: 'loc_crypt', worldTime: 0 },
            createdAt: 1,
          },
          {
            id: 'e_action',
            branchId: 'br_1',
            position: 2,
            kind: 'user_action',
            content: 'I head for the marsh.',
            metadata: { sceneEntities: [], currentLocationId: 'loc_marsh', worldTime: 0 },
            createdAt: 2,
          },
        ])
      }
      const INTO_THORN = { kind: 'under', parentId: 'loc_thorn' } as const

      it("refuses placing or moving the scene's place, or the tail's, into the region", async () => {
        const { db, ctx } = await setup()
        await seed(ctx, db, UNPLACED, [THORN, CRYPT])
        await storyIn(db)
        await expectRefused(ctx, db, place(INTO_THORN), 'story-inside')
        await expectRefused(
          ctx,
          db,
          place(INTO_THORN, { id: 'loc_marsh' }),
          'story-inside',
          undefined,
        )
        expect(await stateIn(db, 'loc_marsh')).toEqual({ parent_location_id: null })
      })

      it('refuses moving a placed place that holds the story', async () => {
        const { db, ctx } = await setup()
        await seed(ctx, db, { parent_location_id: 'loc_reach' }, [THORN, CRYPT])
        await storyIn(db)
        await expectRefused(ctx, db, place(INTO_THORN), 'story-inside', {
          parent_location_id: 'loc_reach',
        })
      })

      it('moves a place the story is outside into the region', async () => {
        const { db, ctx } = await setup()
        await seed(ctx, db, UNPLACED, [THORN])
        await storyIn(db)
        expect((await apply(ctx, place(INTO_THORN), 'act_p')).status).toBe('ok')
      })

      // Its turn's own location lands beside it, so the story's place reads the walk-in already.
      it("leaves the per-turn writer's placement to its planner", async () => {
        const { db, ctx } = await setup()
        await seed(ctx, db, UNPLACED, [THORN, CRYPT])
        await storyIn(db)
        const perTurn: PipelineAction = {
          kind: 'placeLocation',
          source: 'piggyback_tagged_block',
          payload: { branchId: 'br_1', id: 'loc_varn', placement: INTO_THORN, proseEntryId: null },
        }
        expect((await apply(ctx, perTurn, 'act_p')).status).toBe('ok')
      })
    })

    it('refuses a parent whose own chain already loops', async () => {
      const { db, ctx } = await setup()
      await seed(ctx, db, UNPLACED, [
        placeRow('loc_a', { parent_location_id: 'loc_b' }),
        placeRow('loc_b', { parent_location_id: 'loc_a' }),
      ])
      await expectRefused(
        ctx,
        db,
        place({ kind: 'under', parentId: 'loc_a' }),
        'parent-chain-broken',
      )
    })
  })

  // data-model.md → LocationState shape: the flag sits only beside a null parent.
  describe('user edits newer than the prose', () => {
    const fromProse = (placement: { kind: 'under'; parentId: string } | { kind: 'top' }) =>
      place(placement, { proseEntryId: PROSE })

    it('keeps a parent the user picked after the prose', async () => {
      const { db, ctx } = await setup()
      await seed(ctx, db)
      await writeProse(ctx)
      await apply(
        ctx,
        userState({ parent_location_id: 'loc_marsh', condition: 'flooded' }),
        'act_u',
      )
      expect(await apply(ctx, fromProse(UNDER_REACH), 'act_p')).toEqual(
        noopBecause(USER_EDITED_SINCE_PROSE),
      )
      expect(await stateIn(db)).toEqual({ parent_location_id: 'loc_marsh', condition: 'flooded' })
    })

    // The user's edit changed the parent alone, so its undo payload holds no flag.
    it('keeps a move the user made after the prose', async () => {
      const { db, ctx } = await setup()
      await seed(ctx, db, { parent_location_id: 'loc_reach' })
      await writeProse(ctx)
      await apply(ctx, userState({ parent_location_id: 'loc_marsh' }), 'act_u')
      expect(await undoPayloadsOf(db, 'act_u')).toEqual([
        { state: { parent_location_id: 'loc_reach' } },
      ])
      expect(await apply(ctx, fromProse(UNDER_REACH), 'act_p')).toEqual(
        noopBecause(USER_EDITED_SINCE_PROSE),
      )
      expect(await stateIn(db)).toEqual({ parent_location_id: 'loc_marsh' })
    })

    // The user's edit changed the flag alone, so its undo payload holds no parent.
    it('keeps a top-level mark the user made after the prose', async () => {
      const { db, ctx } = await setup()
      await seed(ctx, db)
      await writeProse(ctx)
      await apply(ctx, userState({ parent_location_id: null, condition: 'flooded' }), 'act_u')
      expect(await undoPayloadsOf(db, 'act_u')).toEqual([{ state: { unplaced: true } }])
      expect(await apply(ctx, fromProse(UNDER_REACH), 'act_p')).toEqual(
        noopBecause(USER_EDITED_SINCE_PROSE),
      )
      expect(await stateIn(db)).toEqual({ parent_location_id: null, condition: 'flooded' })
    })

    it('keeps the placement of a place the user created after the prose', async () => {
      const { db, ctx } = await setup()
      await writeProse(ctx)
      await seed(ctx, db)
      expect(await apply(ctx, fromProse(UNDER_REACH), 'act_p')).toEqual(
        noopBecause(USER_EDITED_SINCE_PROSE),
      )
      // The user-created row is unplaced, a valid top target: only precedence refuses it.
      expect(await apply(ctx, fromProse(TOP), 'act_t')).toEqual(
        noopBecause(USER_EDITED_SINCE_PROSE),
      )
    })

    it("places past a later edit of the place's condition", async () => {
      const { db, ctx } = await setup()
      await seed(ctx, db)
      await writeProse(ctx)
      await apply(ctx, userState({ ...UNPLACED, condition: 'drained' }), 'act_u')
      expect((await apply(ctx, fromProse(UNDER_REACH), 'act_p')).status).toBe('ok')
      expect(await stateIn(db)).toEqual({ parent_location_id: 'loc_reach', condition: 'drained' })
    })

    it('places over a placement the user made before the prose', async () => {
      const { db, ctx } = await setup()
      await seed(ctx, db)
      await apply(
        ctx,
        userState({ parent_location_id: 'loc_marsh', condition: 'flooded' }),
        'act_u',
      )
      await writeProse(ctx)
      expect((await apply(ctx, fromProse(UNDER_REACH), 'act_p')).status).toBe('ok')
    })

    // The per-turn writer passes no prose entry: its prose is always newer.
    it('checks nothing without a prose entry', async () => {
      const { db, ctx } = await setup()
      await seed(ctx, db)
      await apply(
        ctx,
        userState({ parent_location_id: 'loc_marsh', condition: 'flooded' }),
        'act_u',
      )
      expect((await apply(ctx, place(UNDER_REACH), 'act_p')).status).toBe('ok')
      expect(await stateIn(db)).toEqual({ parent_location_id: 'loc_reach', condition: 'flooded' })
    })
  })

  it("serializes on the place's row key", () => {
    expect(lockKeysFor(place(TOP))).toEqual(['entities:br_1:loc_varn'])
  })
})

// piggyback.md → Trailing block format.
describe('updateEntityCondition', () => {
  const HALL: NewEntity = {
    ...CHAR,
    id: 'loc_hall',
    kind: 'location',
    name: 'Hall',
    state: { parent_location_id: null, condition: 'swept' },
  }
  const ROPE: NewEntity = {
    ...CHAR,
    id: 'item_rope',
    kind: 'item',
    name: 'Rope',
    state: { at_location_id: 'loc_hall' },
  }
  const setCondition = (ctx: Ctx, id: string, condition: string) =>
    apply(
      ctx,
      {
        kind: 'updateEntityCondition',
        source: 'piggyback_tagged_block',
        payload: { branchId: 'br_1', id, condition },
      },
      'act_k',
    )

  it("replaces a place's condition, leaving its parent, and undo restores the old one", async () => {
    const { db, ctx } = await setup()
    await create(ctx, HALL)
    expect((await setCondition(ctx, 'loc_hall', 'burned to the ground')).status).toBe('ok')
    expect((await rowFor(db, 'loc_hall')).state).toEqual({
      parent_location_id: null,
      condition: 'burned to the ground',
    })
    expect(entitiesStore.getById('loc_hall')?.state).toEqual({
      parent_location_id: null,
      condition: 'burned to the ground',
    })
    expect(await reverseReplayDeltas('act_k', ctx)).toBe(1)
    expect((await rowFor(db, 'loc_hall')).state).toEqual({
      parent_location_id: null,
      condition: 'swept',
    })
  })

  it('gives an item a condition it had none of, and undo takes it away again', async () => {
    const { db, ctx } = await setup()
    await create(ctx, ROPE)
    expect((await setCondition(ctx, 'item_rope', 'frayed through')).status).toBe('ok')
    expect((await rowFor(db, 'item_rope')).state).toEqual({
      at_location_id: 'loc_hall',
      condition: 'frayed through',
    })
    expect(await reverseReplayDeltas('act_k', ctx)).toBe(1)
    expect((await rowFor(db, 'item_rope')).state).toEqual({ at_location_id: 'loc_hall' })
  })

  // The patch builder merges without parsing, so the bound is the handler's own.
  it('bounds an over-long condition as a visual value is', async () => {
    const { db, ctx } = await setup()
    await create(ctx, HALL)
    await setCondition(ctx, 'loc_hall', 'word '.repeat(150).trim())
    const { state } = await rowFor(db, 'loc_hall')
    expect(state).toEqual({
      parent_location_id: null,
      condition: Array.from({ length: 100 }, () => 'word').join(' '),
    })
    expect(entityStateSchemaForKind('location').safeParse(state).success).toBe(true)
  })

  it.each([
    ['a character', 'char_1', noopBecause('not-a-place-or-item')],
    ['a missing row', 'loc_gone', expect.objectContaining({ status: 'rejected', code: 'noop' })],
  ])('refuses %s, as a noop', async (_label, id, refusal) => {
    const { ctx } = await setup()
    await create(ctx, CHAR)
    expect(await setCondition(ctx, id, 'scorched')).toEqual(refusal)
  })

  it('refuses a condition that is already the stored one, as a noop', async () => {
    const { ctx } = await setup()
    await create(ctx, HALL)
    expect(await setCondition(ctx, 'loc_hall', 'swept')).toEqual(
      expect.objectContaining({ status: 'rejected', code: 'noop' }),
    )
  })
})

const REVEAL = 'e_reveal'
const writeRevealProse = (ctx: Ctx) =>
  writeProseEntry(ctx, REVEAL, 'The hooded stranger lowers her hood: she is Mira.')

// classifier.md → What the classifier writes → Names.
describe('renameEntity', () => {
  const STRANGER: NewEntity = {
    ...CHAR,
    status: 'active',
    name: 'the hooded stranger',
    keywords: ['the stranger'],
  }
  const rename = (name: string, proseEntryId: string | null = REVEAL): PipelineAction => ({
    kind: 'renameEntity',
    source: 'periodic_classifier',
    payload: { branchId: 'br_1', id: 'char_1', name, proseEntryId },
  })

  async function seed(ctx: Ctx, db: StateDb, entry: NewEntity = STRANGER) {
    await create(ctx, entry)
    await db.update(entities).set({ embeddingStale: 0 }).where(eq(entities.id, 'char_1'))
    await writeRevealProse(ctx)
  }

  it('writes the name, keeps the old one as a keyword, and marks the row to re-embed', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    expect((await apply(ctx, rename('Mira'), 'act_n')).status).toBe('ok')

    const row = await rowFor(db, 'char_1')
    expect(row).toMatchObject({
      name: 'Mira',
      keywords: ['the stranger', 'the hooded stranger'],
      embeddingStale: 1,
    })
    expect(entitiesStore.getById('char_1')).toMatchObject({
      name: 'Mira',
      keywords: ['the stranger', 'the hooded stranger'],
    })
    expect(await undoPayloadOf(db, 'act_n')).toEqual({
      name: 'the hooded stranger',
      keywords: ['the stranger'],
    })
  })

  it('reverses to the old name and keywords', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    await apply(ctx, rename('Mira'), 'act_n')
    expect(await reverseReplayDeltas('act_n', ctx)).toBe(1)
    expect(await rowFor(db, 'char_1')).toMatchObject({
      name: 'the hooded stranger',
      keywords: ['the stranger'],
    })
  })

  it('adds no keyword the row already holds under another spelling', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db, { ...STRANGER, keywords: ['The Hooded Stranger '] })
    expect((await apply(ctx, rename('Mira'), 'act_n')).status).toBe('ok')
    expect((await rowFor(db, 'char_1')).keywords).toEqual(['The Hooded Stranger '])
    expect(await undoPayloadOf(db, 'act_n')).toEqual({ name: 'the hooded stranger' })
  })

  // classifier.md → What the classifier writes: a keyword write appends and never removes, so a
  // keyword equal to the new name stays; the pass's prompt leaves it off the line.
  it('keeps a keyword equal to the new name', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db, { ...STRANGER, keywords: ['Kael', 'the stranger'] })
    expect((await apply(ctx, rename('Kael'), 'act_n')).status).toBe('ok')
    expect((await rowFor(db, 'char_1')).keywords).toEqual([
      'Kael',
      'the stranger',
      'the hooded stranger',
    ])
  })

  it('no-ops on a change of case or surrounding space alone', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    expect(await apply(ctx, rename(' The Hooded Stranger '), 'act_n')).toEqual(
      noopBecause('name-unchanged'),
    )
    expect((await rowFor(db, 'char_1')).name).toBe('the hooded stranger')
  })

  it('no-ops on a change of inner spacing alone', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db, { ...STRANGER, name: 'the  hooded stranger' })
    expect(await apply(ctx, rename('the hooded stranger'), 'act_n')).toEqual(
      noopBecause('name-unchanged'),
    )
    expect((await rowFor(db, 'char_1')).name).toBe('the  hooded stranger')
  })

  it('writes the trimmed name', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    expect((await apply(ctx, rename('  Mira '), 'act_n')).status).toBe('ok')
    expect((await rowFor(db, 'char_1')).name).toBe('Mira')
  })

  it.each(['', '   '])('no-ops on a blank name %j', async (name) => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    expect(await apply(ctx, rename(name), 'act_n')).toEqual(noopBecause('name-blank'))
    expect((await rowFor(db, 'char_1')).name).toBe('the hooded stranger')
  })

  it('no-ops when the row is gone', async () => {
    const { ctx } = await setup()
    expect(await apply(ctx, rename('Mira'), 'act_n')).toEqual(
      noopBecause('rename target entities br_1:char_1 not found'),
    )
  })

  it('keeps a name the user wrote after the prose', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    await apply(ctx, userPatch({ name: 'the veiled woman' }), 'act_u')
    expect(await apply(ctx, rename('Mira'), 'act_n')).toEqual(userWonOver)
    expect((await rowFor(db, 'char_1')).name).toBe('the veiled woman')
  })

  it('renames past a later edit of the description', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    await apply(ctx, userPatch({ description: 'cloaked, watchful' }), 'act_u')
    expect((await apply(ctx, rename('Mira'), 'act_n')).status).toBe('ok')
    expect((await rowFor(db, 'char_1')).name).toBe('Mira')
  })

  it('renames over a name the user wrote before the prose', async () => {
    const { db, ctx } = await setup()
    await create(ctx, STRANGER)
    await apply(ctx, userPatch({ name: 'the veiled woman' }), 'act_u')
    await writeRevealProse(ctx)
    expect((await apply(ctx, rename('Mira'), 'act_n')).status).toBe('ok')
    expect(await rowFor(db, 'char_1')).toMatchObject({
      name: 'Mira',
      keywords: ['the stranger', 'the veiled woman'],
    })
  })

  it('keeps the name of an entity the user created after the prose', async () => {
    const { db, ctx } = await setup()
    await writeRevealProse(ctx)
    await create(ctx, STRANGER)
    expect(await apply(ctx, rename('Mira'), 'act_n')).toEqual(userWonOver)
    expect((await rowFor(db, 'char_1')).name).toBe('the hooded stranger')
  })

  // cadence.md → User precedence: an alias the user removed after the prose stays removed.
  it('leaves out an old name the user removed from the keywords after the prose', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db, { ...STRANGER, keywords: ['the stranger', 'the hooded stranger'] })
    await apply(ctx, userPatch({ keywords: ['the stranger'] }), 'act_u')
    expect((await apply(ctx, rename('Mira'), 'act_n')).status).toBe('ok')
    expect(await rowFor(db, 'char_1')).toMatchObject({ name: 'Mira', keywords: ['the stranger'] })
  })

  it('checks nothing without a prose entry', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    await apply(ctx, userPatch({ name: 'the veiled woman' }), 'act_u')
    expect((await apply(ctx, rename('Mira', null), 'act_n')).status).toBe('ok')
    expect((await rowFor(db, 'char_1')).name).toBe('Mira')
  })

  it("serializes on the entity's row key", () => {
    expect(lockKeysFor(rename('Mira'))).toEqual(['entities:br_1:char_1'])
  })
})

// classifier.md → Names, judged on the rows as the rename finds them: a write the pass planned
// beside it can have been refused since.
describe('renameEntity onto a name another row holds', () => {
  const proseAt = (ctx: Ctx, id: string, position: number) =>
    apply(
      ctx,
      {
        kind: 'createStoryEntry',
        source: 'ai_classifier',
        payload: {
          entry: {
            id,
            branchId: 'br_1',
            position,
            kind: 'ai_reply',
            content: `Turn ${position}.`,
            createdAt: 1,
          },
        },
      },
      `act_prose_${id}`,
    )
  const createRow = (ctx: Ctx, entry: NewEntity) =>
    apply(
      ctx,
      { kind: 'createEntity', source: 'user_edit', payload: { entry } },
      `act_c_${entry.id}`,
    )
  const renameOf = (id: string, name: string, proseEntryId: string): PipelineAction => ({
    kind: 'renameEntity',
    source: 'periodic_classifier',
    payload: { branchId: 'br_1', id, name, proseEntryId },
  })
  const editOf = (id: string, patch: Record<string, unknown>): PipelineAction => ({
    kind: 'updateEntity',
    source: 'user_edit',
    payload: { branchId: 'br_1', id, patch },
  })
  const person = (id: string, name: string, over: Partial<NewEntity> = {}): NewEntity => ({
    ...CHAR,
    id,
    status: 'active',
    name,
    keywords: [],
    ...over,
  })
  const placeRow = (id: string, name: string, state: LocationState): NewEntity => ({
    ...CHAR,
    id,
    kind: 'location',
    status: 'active',
    name,
    keywords: [],
    state,
  })
  const REGIONS = [
    placeRow('loc_reach', 'the Reach', { parent_location_id: null }),
    placeRow('loc_marsh', 'the Marsh', { parent_location_id: null }),
  ]

  const flagged = (partnerId: string, reason: CollisionReason = 'name-taken') => ({
    nameCollisionFlag: 1 as const,
    nameCollisionPartnerId: partnerId,
    nameCollisionReason: reason,
  })
  const UNFLAGGED = {
    nameCollisionFlag: 0 as const,
    nameCollisionPartnerId: null,
    nameCollisionReason: null,
  }

  it('clashes on a name the user gave a row whose rename away the pass planned first', async () => {
    const { db, ctx } = await setup()
    await createRow(ctx, person('char_2', 'Marra'))
    await createRow(ctx, person('char_1', 'the innkeeper'))
    await proseAt(ctx, 'e_1', 1)
    await apply(ctx, editOf('char_2', { name: 'Mara' }), 'act_u')
    await proseAt(ctx, 'e_2', 2)
    expect(await apply(ctx, renameOf('char_2', 'Selene', 'e_1'), 'act_n1')).toEqual(userWonOver)

    expect((await apply(ctx, renameOf('char_1', 'Mara', 'e_2'), 'act_n2')).status).toBe('ok')
    expect(await rowFor(db, 'char_1')).toMatchObject({
      name: 'the innkeeper',
      keywords: ['Mara'],
      ...flagged('char_2'),
    })
  })

  it('renames onto the name of a rename the user refused', async () => {
    const { db, ctx } = await setup()
    await createRow(ctx, person('char_2', 'Marra'))
    await createRow(ctx, person('char_1', 'the innkeeper'))
    await proseAt(ctx, 'e_1', 1)
    await apply(ctx, editOf('char_2', { name: 'Mara' }), 'act_u')
    await proseAt(ctx, 'e_2', 2)
    expect(await apply(ctx, renameOf('char_2', 'Selene', 'e_1'), 'act_n1')).toEqual(userWonOver)

    expect((await apply(ctx, renameOf('char_1', 'Selene', 'e_2'), 'act_n2')).status).toBe('ok')
    expect(await rowFor(db, 'char_1')).toMatchObject({
      name: 'Selene',
      keywords: ['the innkeeper'],
      ...UNFLAGGED,
    })
  })

  it('clashes on a sibling name when the move away the pass planned first lost to the user', async () => {
    const { db, ctx } = await setup()
    await db
      .insert(entities)
      .values([...REGIONS, placeRow('loc_mill', 'Mill', { parent_location_id: 'loc_marsh' })])
    await createRow(ctx, placeRow('loc_a', 'old mill', { parent_location_id: 'loc_reach' }))
    await proseAt(ctx, 'e_1', 1)
    await apply(ctx, editOf('loc_a', { state: { parent_location_id: 'loc_marsh' } }), 'act_u')
    await proseAt(ctx, 'e_2', 2)
    const backToReach: PipelineAction = {
      kind: 'placeLocation',
      source: 'periodic_classifier',
      payload: {
        branchId: 'br_1',
        id: 'loc_a',
        placement: { kind: 'under', parentId: 'loc_reach' },
        proseEntryId: 'e_1',
      },
    }
    expect(await apply(ctx, backToReach, 'act_p')).toEqual(userWonOver)

    expect((await apply(ctx, renameOf('loc_a', 'Mill', 'e_2'), 'act_n')).status).toBe('ok')
    expect(await rowFor(db, 'loc_a')).toMatchObject({
      name: 'old mill',
      keywords: ['Mill'],
      ...flagged('loc_mill'),
    })
  })

  // piggyback.md → Matching before creating: a real sibling, or any place when either is unplaced.
  it.each([
    ['lands beside a holder under another parent', 'loc_reach', 'loc_marsh', true],
    ['clashes beside an unplaced holder', null, 'loc_marsh', false],
    ['clashes for an unplaced place', 'loc_reach', null, false],
    ['clashes beside a holder whose parent is gone', 'loc_gone', 'loc_reach', false],
  ])(
    'a place rename %s',
    async (_label, holderParent: string | null, ownParent: string | null, lands: boolean) => {
      const at = (parent: string | null): LocationState =>
        parent === null
          ? { parent_location_id: null, unplaced: true }
          : { parent_location_id: parent }
      const { db, ctx } = await setup()
      await db.insert(entities).values([...REGIONS, placeRow('loc_mill', 'Mill', at(holderParent))])
      await createRow(ctx, placeRow('loc_a', 'old mill', at(ownParent)))
      await proseAt(ctx, 'e_1', 1)
      expect((await apply(ctx, renameOf('loc_a', 'Mill', 'e_1'), 'act_n')).status).toBe('ok')
      expect((await rowFor(db, 'loc_a')).name).toBe(lands ? 'Mill' : 'old mill')
    },
  )

  it.each([
    ['clashes when a retired row of the kind holds it', 'character', 'retired', false],
    ['lands when only a row of another kind holds it', 'faction', 'active', true],
  ] as const)('a rename %s', async (_label, kind, status, lands) => {
    const { db, ctx } = await setup()
    await db.insert(entities).values({ ...person('ent_2', 'mara '), kind, status, state: {} })
    await createRow(ctx, person('char_1', 'the innkeeper'))
    await proseAt(ctx, 'e_1', 1)
    expect((await apply(ctx, renameOf('char_1', 'Mara', 'e_1'), 'act_n')).status).toBe('ok')
    expect((await rowFor(db, 'char_1')).name).toBe(lands ? 'Mara' : 'the innkeeper')
  })

  async function seedClash(ctx: Ctx, db: StateDb, innkeeper: Partial<NewEntity> = {}) {
    await db.insert(entities).values(person('char_2', 'Mara'))
    await createRow(ctx, person('char_1', 'the innkeeper', innkeeper))
    await proseAt(ctx, 'e_1', 1)
  }
  const clash = (ctx: Ctx) => apply(ctx, renameOf('char_1', 'Mara', 'e_1'), 'act_n')

  it('writes one delta: the name as a keyword and the flag naming the holder', async () => {
    const { db, ctx } = await setup()
    await seedClash(ctx, db, { keywords: ['the host'] })
    expect((await clash(ctx)).status).toBe('ok')

    const landed = { keywords: ['the host', 'Mara'], ...flagged('char_2') }
    expect(await rowFor(db, 'char_1')).toMatchObject({ name: 'the innkeeper', ...landed })
    expect(entitiesStore.getById('char_1')).toMatchObject(landed)
    expect(await undoPayloadsOf(db, 'act_n')).toEqual([{ keywords: ['the host'], ...UNFLAGGED }])
  })

  it('reverses to the keywords and flag from before it', async () => {
    const { db, ctx } = await setup()
    await seedClash(ctx, db, { keywords: ['the host'] })
    await clash(ctx)
    expect(await reverseReplayDeltas('act_n', ctx)).toBe(1)
    expect(await rowFor(db, 'char_1')).toMatchObject({ keywords: ['the host'], ...UNFLAGGED })
  })

  it('takes the oldest holder as the partner, then the lowest id', async () => {
    const { db, ctx } = await setup()
    await db
      .insert(entities)
      .values([
        person('char_z', 'Mara', { createdAt: 3 }),
        person('char_b', 'Mara', { createdAt: 0 }),
        person('char_a', 'MARA', { createdAt: 0 }),
      ])
    await createRow(ctx, person('char_1', 'the innkeeper'))
    await proseAt(ctx, 'e_1', 1)
    await clash(ctx)
    expect(await rowFor(db, 'char_1')).toMatchObject(flagged('char_a'))
  })

  it('takes a name spaced apart from the one another row holds as that name', async () => {
    const { db, ctx } = await setup()
    await seedClash(ctx, db)
    await apply(ctx, renameOf('char_1', 'Mara  ', 'e_1'), 'act_n')
    expect(await rowFor(db, 'char_1')).toMatchObject({ keywords: ['Mara'], ...flagged('char_2') })
  })

  it('raises alone on a row that already holds the name as a keyword', async () => {
    const { db, ctx } = await setup()
    await seedClash(ctx, db, { keywords: ['mara'] })
    expect((await clash(ctx)).status).toBe('ok')
    expect(await rowFor(db, 'char_1')).toMatchObject({ keywords: ['mara'], ...flagged('char_2') })
    expect(await undoPayloadsOf(db, 'act_n')).toEqual([UNFLAGGED])
  })

  describe('a row already flagged', () => {
    const FLAGGED_DISTINCT = flagged('char_3', 'distinct')

    it('gets the keyword only, keeping a flag that holds and its partner', async () => {
      const { db, ctx } = await setup()
      await db.insert(entities).values(person('char_3', 'the innkeeper'))
      await seedClash(ctx, db, FLAGGED_DISTINCT)
      expect((await clash(ctx)).status).toBe('ok')
      expect(await rowFor(db, 'char_1')).toMatchObject({ keywords: ['Mara'], ...FLAGGED_DISTINCT })
      expect(await undoPayloadsOf(db, 'act_n')).toEqual([{ keywords: [] }])
    })

    it('writes nothing when it holds the keyword and the flag holds', async () => {
      const { db, ctx } = await setup()
      await seedClash(ctx, db, { keywords: ['Mara'], ...flagged('char_2') })
      expect(await clash(ctx)).toEqual(noopBecause('name-taken'))
      expect(await undoPayloadsOf(db, 'act_n')).toEqual([])
    })

    // classifier.md → Names: a dormant flag, one World's pairing rule no longer holds, counts as none.
    it.each([
      ['a partner it shares no name with', 'char_3'],
      ['a partner that is gone', 'char_gone'],
    ])('re-points a flag dormant on %s, and reverses to it', async (_label, oldPartner) => {
      const { db, ctx } = await setup()
      await db.insert(entities).values(person('char_3', 'Zed'))
      await seedClash(ctx, db, flagged(oldPartner, 'distinct'))
      expect((await clash(ctx)).status).toBe('ok')
      expect(await rowFor(db, 'char_1')).toMatchObject(flagged('char_2'))
      await reverseReplayDeltas('act_n', ctx)
      expect(await rowFor(db, 'char_1')).toMatchObject(flagged(oldPartner, 'distinct'))
    })

    // A check on the row as it stands would re-point this: the keyword is what revives the pair.
    it("keeps a dormant flag the clash's own keyword brings back to life", async () => {
      const { db, ctx } = await setup()
      await db.insert(entities).values(person('char_3', 'Mara', { createdAt: 3 }))
      await seedClash(ctx, db, flagged('char_3', 'distinct'))
      expect((await clash(ctx)).status).toBe('ok')
      expect(await rowFor(db, 'char_1')).toMatchObject({
        keywords: ['Mara'],
        ...flagged('char_3', 'distinct'),
      })
    })
  })

  // cadence.md → User edits and classifier writes, each column by its own edits.
  describe('after a user edit', () => {
    it('clashes past a name the user wrote after the prose', async () => {
      const { db, ctx } = await setup()
      await seedClash(ctx, db)
      await apply(ctx, editOf('char_1', { name: 'the landlord' }), 'act_u')
      expect((await clash(ctx)).status).toBe('ok')
      expect(await rowFor(db, 'char_1')).toMatchObject({
        name: 'the landlord',
        keywords: ['Mara'],
        ...flagged('char_2'),
      })
    })

    it('adds the keyword past a flag the user cleared after the prose, and raises nothing', async () => {
      const { db, ctx } = await setup()
      await seedClash(ctx, db, flagged('char_2', 'distinct'))
      await apply(ctx, editOf('char_1', UNFLAGGED), 'act_u')
      expect((await clash(ctx)).status).toBe('ok')
      expect(await rowFor(db, 'char_1')).toMatchObject({ keywords: ['Mara'], ...UNFLAGGED })
      expect(await undoPayloadsOf(db, 'act_n')).toEqual([{ keywords: [] }])
    })

    it('raises past a keyword the user removed when the names alone pair', async () => {
      const { db, ctx } = await setup()
      await seedClash(ctx, db, { name: 'Mara Vale', keywords: ['Mara'] })
      await apply(ctx, editOf('char_1', { keywords: [] }), 'act_u')
      expect((await clash(ctx)).status).toBe('ok')
      expect(await rowFor(db, 'char_1')).toMatchObject({ keywords: [], ...flagged('char_2') })
    })

    it('writes nothing when the keyword the user removed was all that paired them', async () => {
      const { db, ctx } = await setup()
      await seedClash(ctx, db, { keywords: ['Mara'] })
      await apply(ctx, editOf('char_1', { keywords: [] }), 'act_u')
      expect(await clash(ctx)).toEqual(noopBecause('name-taken'))
      expect(await rowFor(db, 'char_1')).toMatchObject({ keywords: [], ...UNFLAGGED })
    })
  })

  describe('the clash log', () => {
    afterEach(() => __resetDiagnosticsGate())
    const logged = () =>
      getDiagnosticsSnapshot()
        .logEntries.filter((e) => e.kind === 'classifier.rename_clash')
        .map((e) => [e.level, e.fields, e.actionId])

    it.each([
      ['a raise that landed', {}, true],
      ['a flag that holds', { keywords: ['Mara'], ...flagged('char_2') }, false],
    ])('reports %s, against the run', async (_label, over, raised) => {
      clearBuffers()
      configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
      const { db, ctx } = await setup()
      await seedClash(ctx, db, over)
      await clash(ctx)
      expect(logged()).toEqual([
        ['warn', { ref: 'char_1', name: 'Mara', partnerId: 'char_2', flagged: raised }, 'act_n'],
      ])
    })

    it('stays quiet for a rename that lands', async () => {
      clearBuffers()
      configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
      const { ctx } = await setup()
      await createRow(ctx, person('char_1', 'the innkeeper'))
      await proseAt(ctx, 'e_1', 1)
      await clash(ctx)
      expect(logged()).toEqual([])
    })
  })
})

// edge-cases.md → Layer B: a pass whose rename meets a name another row of the kind holds.
describe('raiseCollisionFlag', () => {
  // A clash's keyword lands before its raise, so the pair are namesakes through it.
  const STRANGER: NewEntity = {
    ...CHAR,
    status: 'active',
    name: 'the hooded stranger',
    keywords: ['Mira'],
  }
  const MIRA: NewEntity = { ...CHAR, id: 'char_2', status: 'active', name: 'Mira' }
  const raise = (partnerId = 'char_2', proseEntryId: string | null = REVEAL): PipelineAction => ({
    kind: 'raiseCollisionFlag',
    source: 'periodic_classifier',
    payload: { branchId: 'br_1', id: 'char_1', partnerId, reason: 'name-taken', proseEntryId },
  })
  const flagOf = async (db: StateDb) => {
    const row = await rowFor(db, 'char_1')
    return [row.nameCollisionFlag, row.nameCollisionPartnerId, row.nameCollisionReason]
  }

  async function seed(ctx: Ctx, db: StateDb, stranger: NewEntity = STRANGER) {
    await db.insert(entities).values(MIRA)
    await create(ctx, stranger)
    await writeRevealProse(ctx)
  }

  it('raises the flag with its partner and reason, and reverses to none', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    expect((await apply(ctx, raise(), 'act_f')).status).toBe('ok')

    expect(await flagOf(db)).toEqual([1, 'char_2', 'name-taken'])
    expect(entitiesStore.getById('char_1')).toMatchObject({
      nameCollisionFlag: 1,
      nameCollisionPartnerId: 'char_2',
      nameCollisionReason: 'name-taken',
    })
    expect(await undoPayloadOf(db, 'act_f')).toEqual({
      nameCollisionFlag: 0,
      nameCollisionPartnerId: null,
      nameCollisionReason: null,
    })
    expect(await reverseReplayDeltas('act_f', ctx)).toBe(1)
    expect(await flagOf(db)).toEqual([0, null, null])
  })

  it('leaves the flag cleared when the user cleared it after the raise', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    await apply(ctx, raise(), 'act_f')
    await apply(
      ctx,
      userPatch({ nameCollisionFlag: 0, nameCollisionPartnerId: null, nameCollisionReason: null }),
      'act_u',
    )
    await reverseReplayDeltas('act_f', ctx)
    expect(await flagOf(db)).toEqual([0, null, null])
  })

  // generation-pipeline.md → Reverse-replay: the three flag columns are one field, so the CHECK
  // that ties them survives a partial keep.
  it.each([
    ['re-points the partner', { nameCollisionPartnerId: 'char_3' }, [1, 'char_3', 'name-taken']],
    [
      're-points the partner and reason',
      { nameCollisionPartnerId: 'char_3', nameCollisionReason: 'distinct' },
      [1, 'char_3', 'distinct'],
    ],
  ])('keeps the flag whole when the user %s after the raise', async (_label, patch, flag) => {
    const { db, ctx } = await setup()
    await db.insert(entities).values({ ...MIRA, id: 'char_3' })
    await seed(ctx, db)
    await apply(ctx, raise(), 'act_f')
    await apply(ctx, userPatch(patch), 'act_u')
    await reverseReplayDeltas('act_f', ctx)
    expect(await flagOf(db)).toEqual(flag)
  })

  it('no-ops on a row already flagged, which keeps its partner', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values({ ...CHAR, id: 'char_3', status: 'active', name: 'Mira' })
    await seed(ctx, db, {
      ...STRANGER,
      nameCollisionFlag: 1,
      nameCollisionPartnerId: 'char_3',
      nameCollisionReason: 'alike',
    })
    expect(await apply(ctx, raise(), 'act_f')).toEqual(noopBecause('already-flagged'))
    expect(await flagOf(db)).toEqual([1, 'char_3', 'alike'])
  })

  // classifier.md → Names: a dormant flag, one World's pairing rule no longer holds, counts as none.
  it.each([
    ['a partner it no longer shares a name with', 'char_3'],
    ['a partner that is gone', 'char_gone'],
  ])('re-points a flag dormant on %s, and reverses to it', async (_label, oldPartner) => {
    const { db, ctx } = await setup()
    await db.insert(entities).values({ ...CHAR, id: 'char_3', status: 'active', name: 'Zed' })
    await seed(ctx, db, {
      ...STRANGER,
      nameCollisionFlag: 1,
      nameCollisionPartnerId: oldPartner,
      nameCollisionReason: 'distinct',
    })
    expect((await apply(ctx, raise(), 'act_f')).status).toBe('ok')
    expect(await flagOf(db)).toEqual([1, 'char_2', 'name-taken'])
    await reverseReplayDeltas('act_f', ctx)
    expect(await flagOf(db)).toEqual([1, oldPartner, 'distinct'])
  })

  it.each([
    ['is gone', 'char_gone', 'partner-not-found'],
    ['is of another kind', 'fact_1', 'partner-not-of-kind'],
  ])('no-ops when the partner %s', async (_label, partnerId, reason) => {
    const { db, ctx } = await setup()
    await db.insert(entities).values({
      ...CHAR,
      id: 'fact_1',
      kind: 'faction',
      name: 'Mira',
      status: 'active',
      state: {},
    })
    await seed(ctx, db)
    expect(await apply(ctx, raise(partnerId), 'act_f')).toEqual(noopBecause(reason))
    expect(await flagOf(db)).toEqual([0, null, null])
  })

  it('no-ops on the row as its own partner', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    expect(await apply(ctx, raise('char_1'), 'act_f')).toEqual(noopBecause('partner-is-self'))
  })

  // world.md → Surfacing: a flag needs a namesake pair, so none is raised on a pair without one.
  it('no-ops on a pair that share no name, as when the user removed the keyword', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db, { ...STRANGER, keywords: ['the hood'] })
    expect(await apply(ctx, raise(), 'act_f')).toEqual(noopBecause('not-namesakes'))
    expect(await flagOf(db)).toEqual([0, null, null])
  })

  it('raises on a pair whose names alone match', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db, { ...STRANGER, name: 'Mira Vale', keywords: [] })
    expect((await apply(ctx, raise(), 'act_f')).status).toBe('ok')
    expect(await flagOf(db)).toEqual([1, 'char_2', 'name-taken'])
  })

  it.each([
    ['refuses', 'loc_south', noopBecause('not-namesakes')],
    ['raises', 'loc_north', { status: 'ok' }],
  ])('%s a same-parent flag on namesake places under %s', async (_label, parent, outcome) => {
    const { db, ctx } = await setup()
    const place = (id: string, name: string, state: Record<string, unknown>): NewEntity => ({
      ...CHAR,
      id,
      kind: 'location',
      status: 'active',
      name,
      keywords: [],
      state,
    })
    await db
      .insert(entities)
      .values([
        place('loc_north', 'the North', { parent_location_id: null }),
        place('loc_south', 'the South', { parent_location_id: null }),
        place('loc_varn_2', 'Varn', { parent_location_id: parent }),
      ])
    await create(ctx, place('loc_varn', 'Varn', { parent_location_id: 'loc_north' }))
    await writeRevealProse(ctx)
    const sameParent: PipelineAction = {
      kind: 'raiseCollisionFlag',
      source: 'periodic_classifier',
      payload: {
        branchId: 'br_1',
        id: 'loc_varn',
        partnerId: 'loc_varn_2',
        reason: 'same-parent',
        proseEntryId: REVEAL,
      },
    }
    expect(await apply(ctx, sameParent, 'act_f')).toMatchObject(outcome)
  })

  it('no-ops when the row is gone', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values(MIRA)
    expect(await apply(ctx, raise(), 'act_f')).toEqual(
      noopBecause('flag target entities br_1:char_1 not found'),
    )
  })

  // cadence.md → User edits and classifier writes: the user's resolution outranks older prose.
  it('keeps a flag the user cleared after the prose', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db, {
      ...STRANGER,
      nameCollisionFlag: 1,
      nameCollisionPartnerId: 'char_2',
      nameCollisionReason: 'distinct',
    })
    await apply(
      ctx,
      userPatch({ nameCollisionFlag: 0, nameCollisionPartnerId: null, nameCollisionReason: null }),
      'act_u',
    )
    expect(await apply(ctx, raise(), 'act_f')).toEqual(userWonOver)
    expect(await flagOf(db)).toEqual([0, null, null])
  })

  // The three columns are one field: a re-point of the partner alone shields the flag too.
  it('keeps a dormant flag the user re-pointed after the prose', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values({ ...CHAR, id: 'char_3', status: 'active', name: 'Zed' })
    await seed(ctx, db, {
      ...STRANGER,
      nameCollisionFlag: 1,
      nameCollisionPartnerId: 'char_gone',
      nameCollisionReason: 'distinct',
    })
    await apply(ctx, userPatch({ nameCollisionPartnerId: 'char_3' }), 'act_u')
    expect(await apply(ctx, raise(), 'act_f')).toEqual(userWonOver)
    expect(await flagOf(db)).toEqual([1, 'char_3', 'distinct'])
  })

  it('raises past a later edit of the description', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, db)
    await apply(ctx, userPatch({ description: 'cloaked, watchful' }), 'act_u')
    expect((await apply(ctx, raise(), 'act_f')).status).toBe('ok')
  })

  it('raises over a clear the user made before the prose', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values(MIRA)
    await create(ctx, {
      ...STRANGER,
      nameCollisionFlag: 1,
      nameCollisionPartnerId: 'char_2',
      nameCollisionReason: 'distinct',
    })
    await apply(
      ctx,
      userPatch({ nameCollisionFlag: 0, nameCollisionPartnerId: null, nameCollisionReason: null }),
      'act_u',
    )
    await writeRevealProse(ctx)
    expect((await apply(ctx, raise(), 'act_f')).status).toBe('ok')
    expect(await flagOf(db)).toEqual([1, 'char_2', 'name-taken'])
  })

  // The create check takes the new reason as it takes the others.
  it('creates a row flagged name-taken', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values(MIRA)
    const created = await create(ctx, {
      ...STRANGER,
      nameCollisionFlag: 1,
      nameCollisionPartnerId: 'char_2',
      nameCollisionReason: 'name-taken',
    })
    expect(created.status).toBe('ok')
    expect(await flagOf(db)).toEqual([1, 'char_2', 'name-taken'])
  })

  it("serializes on the entity's row key", () => {
    expect(lockKeysFor(raise())).toEqual(['entities:br_1:char_1'])
  })
})

// classifier.md → Factions: a standing a pass sets on explicit prose.
describe('setFactionStanding', () => {
  const CIRCLE: NewEntity = {
    id: 'fact_1',
    branchId: 'br_1',
    kind: 'faction',
    name: 'The Iron Circle',
    status: 'active',
    injectionMode: 'auto',
    state: { standing: 'a quiet guild', agenda: ['corner the iron trade'] },
    createdAt: 1,
    updatedAt: 1,
  }
  const standing = (value: string, id = 'fact_1'): PipelineAction => ({
    kind: 'setFactionStanding',
    source: 'periodic_classifier',
    payload: { branchId: 'br_1', id, standing: value, proseEntryId: REVEAL },
  })
  const userFactionState = (state: Record<string, unknown>): PipelineAction => ({
    kind: 'updateEntity',
    source: 'user_edit',
    payload: { branchId: 'br_1', id: 'fact_1', patch: { state } },
  })

  async function seed(ctx: Ctx, entry: NewEntity = CIRCLE) {
    await create(ctx, entry)
    await writeRevealProse(ctx)
  }

  it('writes the standing alone, so its undo payload holds only that field', async () => {
    const { db, ctx } = await setup()
    await seed(ctx)
    expect((await apply(ctx, standing('at war with the crown'), 'act_s')).status).toBe('ok')

    expect((await rowFor(db, 'fact_1')).state).toEqual({
      standing: 'at war with the crown',
      agenda: ['corner the iron trade'],
    })
    expect(entitiesStore.getById('fact_1')?.state).toMatchObject({
      standing: 'at war with the crown',
    })
    expect(await undoPayloadOf(db, 'act_s')).toEqual({ state: { standing: 'a quiet guild' } })
  })

  it("bounds a standing to the schema's 500 characters", async () => {
    const { db, ctx } = await setup()
    await seed(ctx)
    expect((await apply(ctx, standing('x'.repeat(600)), 'act_s')).status).toBe('ok')
    const { state } = await rowFor(db, 'fact_1')
    expect((state as { standing: string }).standing).toHaveLength(500)
    expect(entityStateSchemaForKind('faction').safeParse(state).success).toBe(true)
  })

  it('writes onto a faction whose state column is null', async () => {
    const { db, ctx } = await setup()
    await seed(ctx)
    await db.update(entities).set({ state: null }).where(eq(entities.id, 'fact_1'))
    expect((await apply(ctx, standing('outlawed'), 'act_s')).status).toBe('ok')
    const { state } = await rowFor(db, 'fact_1')
    expect(state).toMatchObject({ standing: 'outlawed' })
    expect(entityStateSchemaForKind('faction').safeParse(state).success).toBe(true)
  })

  it('no-ops when the standing already matches', async () => {
    const { ctx } = await setup()
    await seed(ctx)
    expect(await apply(ctx, standing('a quiet guild'), 'act_s')).toEqual(
      noopBecause('standing-unchanged'),
    )
  })

  it('no-ops on a row that is not a faction', async () => {
    const { ctx } = await setup()
    await seed(ctx)
    await create(ctx, CHAR)
    expect(await apply(ctx, standing('outlawed', 'char_1'), 'act_s')).toEqual(
      noopBecause('not-a-faction'),
    )
  })

  it('no-ops when the row is gone', async () => {
    const { ctx } = await setup()
    expect(await apply(ctx, standing('outlawed'), 'act_s')).toEqual(
      noopBecause('standing target entities br_1:fact_1 not found'),
    )
  })

  it('keeps a standing the user wrote after the prose', async () => {
    const { db, ctx } = await setup()
    await seed(ctx)
    await apply(ctx, userFactionState({ ...CIRCLE.state, standing: 'in hiding' }), 'act_u')
    expect(await apply(ctx, standing('at war with the crown'), 'act_s')).toEqual(userWonOver)
    expect((await rowFor(db, 'fact_1')).state).toMatchObject({ standing: 'in hiding' })
  })

  it("writes past a later edit of the faction's agenda", async () => {
    const { db, ctx } = await setup()
    await seed(ctx)
    await apply(ctx, userFactionState({ ...CIRCLE.state, agenda: ['buy the mines'] }), 'act_u')
    expect((await apply(ctx, standing('at war with the crown'), 'act_s')).status).toBe('ok')
    expect((await rowFor(db, 'fact_1')).state).toEqual({
      standing: 'at war with the crown',
      agenda: ['buy the mines'],
    })
  })

  it('writes over a standing the user wrote before the prose', async () => {
    const { ctx } = await setup()
    await create(ctx, CIRCLE)
    await apply(ctx, userFactionState({ ...CIRCLE.state, standing: 'in hiding' }), 'act_u')
    await writeRevealProse(ctx)
    expect((await apply(ctx, standing('at war with the crown'), 'act_s')).status).toBe('ok')
  })

  it('keeps the standing of a faction the user created after the prose', async () => {
    const { ctx } = await setup()
    await writeRevealProse(ctx)
    await create(ctx, CIRCLE)
    expect(await apply(ctx, standing('at war with the crown'), 'act_s')).toEqual(userWonOver)
  })

  it("serializes on the faction's row key", () => {
    expect(lockKeysFor(standing('outlawed'))).toEqual(['entities:br_1:fact_1'])
  })
})

// classifier.md → What the classifier writes → Status transitions: retired → active.
describe('returnFromRetirement', () => {
  const RETIRED: NewEntity = { ...CHAR, status: 'retired', retiredReason: 'fell at the ford' }
  const comeBack = (id = 'char_1', proseEntryId: string | null = REVEAL): PipelineAction => ({
    kind: 'returnFromRetirement',
    source: 'periodic_classifier',
    payload: { branchId: 'br_1', id, proseEntryId },
  })

  async function seed(ctx: Ctx, entry: NewEntity = RETIRED) {
    await create(ctx, entry)
    await writeRevealProse(ctx)
  }

  it('brings a retired character back, clearing the reason, and reverses to retired', async () => {
    const { db, ctx } = await setup()
    await seed(ctx)
    expect((await apply(ctx, comeBack(), 'act_r')).status).toBe('ok')

    expect(await rowFor(db, 'char_1')).toMatchObject({ status: 'active', retiredReason: null })
    expect(entitiesStore.getById('char_1')).toMatchObject({ status: 'active', retiredReason: null })
    expect(await undoPayloadOf(db, 'act_r')).toEqual({
      status: 'retired',
      retiredReason: 'fell at the ford',
    })
    expect(await reverseReplayDeltas('act_r', ctx)).toBe(1)
    expect(await rowFor(db, 'char_1')).toMatchObject({
      status: 'retired',
      retiredReason: 'fell at the ford',
    })
  })

  it.each(['active', 'staged'] as const)('no-ops on a character now %s', async (status) => {
    const { ctx } = await setup()
    await seed(ctx, { ...RETIRED, status })
    expect(await apply(ctx, comeBack(), 'act_r')).toEqual(noopBecause('not-retired'))
  })

  // Only the user brings back a place (data-model.md → Authorship contract).
  it.each([
    ['location', { parent_location_id: null }],
    ['faction', {}],
  ] as const)('no-ops on a retired %s', async (kind, state) => {
    const { db, ctx } = await setup()
    await seed(ctx, { ...RETIRED, kind, state })
    expect(await apply(ctx, comeBack(), 'act_r')).toEqual(noopBecause('not-a-character'))
    expect((await rowFor(db, 'char_1')).status).toBe('retired')
  })

  it('no-ops when the row is gone', async () => {
    const { ctx } = await setup()
    expect(await apply(ctx, comeBack('char_gone'), 'act_r')).toEqual(
      noopBecause('return target entities br_1:char_gone not found'),
    )
  })

  it('keeps a retirement the user wrote after the prose', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, { ...RETIRED, status: 'active', retiredReason: null })
    await apply(ctx, userPatch({ status: 'retired', retiredReason: 'exiled' }), 'act_u')
    expect(await apply(ctx, comeBack(), 'act_r')).toEqual(userWonOver)
    expect(await rowFor(db, 'char_1')).toMatchObject({ status: 'retired', retiredReason: 'exiled' })
  })

  // data-model.md → Authorship contract: `status` and `retired_reason` are one field row.
  it.each([
    ['status', { status: 'retired' }, 'active'],
    ['retired reason', { retiredReason: 'exiled' }, 'retired'],
  ])(
    'keeps a retirement whose %s alone the user wrote after the prose',
    async (_l, patch, from) => {
      const { db, ctx } = await setup()
      await seed(ctx, { ...RETIRED, status: from as 'active' | 'retired', retiredReason: null })
      await apply(ctx, userPatch(patch), 'act_u')
      expect(await apply(ctx, comeBack(), 'act_r')).toEqual(userWonOver)
      expect((await rowFor(db, 'char_1')).status).toBe('retired')
    },
  )

  it('returns over a retirement the user wrote before the prose', async () => {
    const { db, ctx } = await setup()
    await create(ctx, { ...RETIRED, status: 'active', retiredReason: null })
    await apply(ctx, userPatch({ status: 'retired', retiredReason: 'exiled' }), 'act_u')
    await writeRevealProse(ctx)
    expect((await apply(ctx, comeBack(), 'act_r')).status).toBe('ok')
    expect((await rowFor(db, 'char_1')).status).toBe('active')
  })

  it('returns past a later edit of the description', async () => {
    const { db, ctx } = await setup()
    await seed(ctx)
    await apply(ctx, userPatch({ description: 'thought drowned' }), 'act_u')
    expect((await apply(ctx, comeBack(), 'act_r')).status).toBe('ok')
    expect((await rowFor(db, 'char_1')).status).toBe('active')
  })

  it('checks nothing without a prose entry', async () => {
    const { db, ctx } = await setup()
    await seed(ctx, { ...RETIRED, status: 'active', retiredReason: null })
    await apply(ctx, userPatch({ status: 'retired', retiredReason: 'exiled' }), 'act_u')
    expect((await apply(ctx, comeBack('char_1', null), 'act_r')).status).toBe('ok')
    expect((await rowFor(db, 'char_1')).status).toBe('active')
  })

  it("serializes on the character's row key", () => {
    expect(lockKeysFor(comeBack())).toEqual(['entities:br_1:char_1'])
  })
})

// data-model.md → Authorship contract: `status` and `retired_reason` are one field row, so a user
// edit of either keeps both, through a reversal and against a write that lands later.
describe("a retirement's status and reason, one field", () => {
  const ACTIVE: NewEntity = { ...CHAR, status: 'active', retiredReason: null }
  const RETIRED: NewEntity = { ...CHAR, status: 'retired', retiredReason: 'fell at the ford' }
  const write = (kind: 'retireEntity' | 'returnFromRetirement' | 'promoteStagedEntity') =>
    ({
      kind,
      source: 'periodic_classifier',
      payload: {
        branchId: 'br_1',
        id: 'char_1',
        proseEntryId: REVEAL,
        ...(kind === 'retireEntity' ? { retiredReason: 'drowned' } : {}),
      },
    }) as PipelineAction
  const statusOf = async (db: StateDb) => {
    const row = await rowFor(db, 'char_1')
    return [row.status, row.retiredReason]
  }

  it('keeps a retirement whose reason the user rewrote through its reversal', async () => {
    const { db, ctx } = await setup()
    await create(ctx, ACTIVE)
    await writeRevealProse(ctx)
    expect((await apply(ctx, write('retireEntity'), 'act_r')).status).toBe('ok')
    await apply(ctx, userPatch({ retiredReason: 'lost at sea' }), 'act_u')
    await reverseReplayDeltas('act_r', ctx)
    expect(await statusOf(db)).toEqual(['retired', 'lost at sea'])
  })

  it('keeps a return whose reason the user wrote through its reversal', async () => {
    const { db, ctx } = await setup()
    await create(ctx, RETIRED)
    await writeRevealProse(ctx)
    expect((await apply(ctx, write('returnFromRetirement'), 'act_r')).status).toBe('ok')
    await apply(ctx, userPatch({ retiredReason: 'came back changed' }), 'act_u')
    await reverseReplayDeltas('act_r', ctx)
    expect(await statusOf(db)).toEqual(['active', 'came back changed'])
  })

  it.each([
    ['retire', ACTIVE, 'retireEntity'],
    ['promote', CHAR, 'promoteStagedEntity'],
  ] as const)(
    'refuses to %s a row whose reason alone the user wrote after the prose',
    async (_label, entry, kind) => {
      const { db, ctx } = await setup()
      await create(ctx, entry)
      await writeRevealProse(ctx)
      await apply(ctx, userPatch({ retiredReason: 'a note' }), 'act_u')
      expect(await apply(ctx, write(kind), 'act_w')).toEqual(userWonOver)
      expect(await statusOf(db)).toEqual([entry.status, 'a note'])
    },
  )
})
