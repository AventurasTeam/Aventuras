import { and, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import {
  branches,
  characterRelationships,
  deltas,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  stories,
  type CharacterRelationship,
  type Entity,
  type EntityState,
  type HappeningAwareness,
  type HappeningInvolvement,
  type NewEntity,
  type NewHappening,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { logger } from '@/lib/diagnostics'
import { entitiesStore } from '@/lib/stores'

import type { PipelineActionMap } from '../action-map'
import { registerEntities } from './register'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'
import { registerHappeningAwareness } from '../happenings/register-awareness'
import { registerHappenings } from '../happenings/register-happenings'
import { registerHappeningInvolvements } from '../happenings/register-involvements'
import { registerCharacterRelationships } from '../relationships/register'
import type { PipelineAction } from '../types'

async function setup() {
  // Registration is process-global; reset so only entities is live for this test.
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
  status: 'active',
  injectionMode: 'auto',
  state: {
    visual: { attire: 'cloak' },
    traits: ['brave'],
    drives: [],
    current_location_id: 'loc_1',
    equipped_items: [],
    inventory: [],
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

describe('entities CRUD arms', () => {
  it('create writes the row + create-patch into the held-branch store', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createEntity', source: 'user_edit', payload: { entry: CHAR } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'char_1')).name).toBe('Kael')
    expect(entitiesStore.getById('br_1', 'char_1')?.kind).toBe('character')
    expect(entitiesStore.getById('br_1', 'char_1')?.state).toMatchObject({
      visual: { attire: 'cloak' },
    })
  })

  it('rejects an empty-set update (no updatable fields → no throw, no delta)', async () => {
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
          kind: 'updateEntity',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'char_1', patch: {} },
        },
        actionId: 'act_noop',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect((await rowFor(db, 'char_1')).name).toBe('Kael') // unchanged
    expect((await db.select().from(deltas)).length).toBe(1) // only the create delta
  })

  // Drizzle skips an undefined key, so committing would leave the row as it was while the
  // store, the undo payload and History recorded a write.
  it('refuses a column set to undefined, and codes a missing row as not-found', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createEntity', source: 'user_edit', payload: { entry: CHAR } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    const update = (id: string, patch: Record<string, unknown>) =>
      applyDeltaAction(
        {
          action: {
            kind: 'updateEntity',
            source: 'user_edit',
            payload: { branchId: 'br_1', id, patch },
          },
          actionId: 'act_u',
          branchId: 'br_1',
        },
        ctx,
      )

    expect(await update('char_1', { name: undefined, description: 'rewritten' })).toMatchObject({
      status: 'rejected',
    })
    expect((await rowFor(db, 'char_1')).description).toBe('a wandering knight')
    expect(entitiesStore.getEntities('br_1').get('char_1')?.name).toBe('Kael')
    expect((await db.select().from(deltas)).length).toBe(1)
    expect(await update('char_9', { description: 'rewritten' })).toMatchObject({
      status: 'rejected',
      code: 'not-found',
    })
  })

  it('a write to a non-held branch no-ops against the store', async () => {
    const { db, ctx } = await setup()
    entitiesStore.hydrate('br_2', []) // store now holds br_2, not br_1
    await applyDeltaAction(
      {
        action: { kind: 'createEntity', source: 'user_edit', payload: { entry: CHAR } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'char_1')).name).toBe('Kael') // DB written
    expect(entitiesStore.getById('br_2', 'char_1')).toBeUndefined() // store no-op
  })

  it('rejects an out-of-bounds state on create (no row, no delta)', async () => {
    const { db, ctx } = await setup()
    const bad: NewEntity = { ...CHAR, state: { ...CHAR.state!, traits: Array(51).fill('x') } }
    const result = await applyDeltaAction(
      {
        action: { kind: 'createEntity', source: 'user_edit', payload: { entry: bad } },
        actionId: 'act_bad',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect(await rowFor(db, 'char_1')).toBeUndefined()
    expect((await db.select().from(deltas)).length).toBe(0)
  })

  it('update produces a nested-partial undo; reverse-replay restores row + store', async () => {
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
          kind: 'updateEntity',
          source: 'user_edit',
          payload: {
            branchId: 'br_1',
            id: 'char_1',
            patch: {
              name: 'Kaelin', // scalar change
              state: {
                ...CHAR.state!,
                visual: { attire: 'armor' }, // nested-object change
                voice: 'gruff', // optional-leaf absent -> present (undo=null=delete on reverse)
                current_location_id: null, // nullable-leaf non-null -> null
                stackables: { gold: 5, arrows: 12 }, // record add
              },
            },
          },
        },
        actionId: 'act_u',
        branchId: 'br_1',
      },
      ctx,
    )

    // forward applied to DB + store
    expect((await rowFor(db, 'char_1')).name).toBe('Kaelin')
    expect(entitiesStore.getById('br_1', 'char_1')?.state).toMatchObject({
      visual: { attire: 'armor' },
      voice: 'gruff',
      current_location_id: null,
    })

    // reverse-replay restores both; covers the three null-sentinel node types:
    // optional-leaf (voice deleted), nullable-leaf (current_location_id), record sub-key (arrows deleted).
    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    const back = await rowFor(db, 'char_1')
    expect(back.name).toBe('Kael')
    expect(back.state).toMatchObject({
      visual: { attire: 'cloak' },
      current_location_id: 'loc_1',
      stackables: { gold: 5 },
    })
    expect(back.state).not.toHaveProperty('voice') // optional-leaf restored to absent
    expect((back.state as { stackables: Record<string, number> }).stackables).not.toHaveProperty(
      'arrows',
    )
    expect(entitiesStore.getById('br_1', 'char_1')?.state).toMatchObject({
      visual: { attire: 'cloak' },
      current_location_id: 'loc_1',
    })
  })

  it('delete captures the full row; reverse-replay re-inserts + store create-patch', async () => {
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
          kind: 'deleteEntity',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'char_1' },
        },
        actionId: 'act_d',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(await rowFor(db, 'char_1')).toBeUndefined()
    expect(entitiesStore.getById('br_1', 'char_1')).toBeUndefined()

    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    expect((await rowFor(db, 'char_1')).name).toBe('Kael')
    expect(entitiesStore.getById('br_1', 'char_1')?.name).toBe('Kael')
  })

  it('defaults embedding_stale to 1 on create', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createEntity', source: 'user_edit', payload: { entry: CHAR } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'char_1')).embeddingStale).toBe(1)
  })

  it('flips embedding_stale only when an embedded column changes', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'createEntity',
          source: 'user_edit',
          payload: { entry: { ...CHAR, embeddingStale: 0 } },
        },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )

    await applyDeltaAction(
      {
        action: {
          kind: 'updateEntity',
          source: 'user_edit',
          payload: {
            branchId: 'br_1',
            id: 'char_1',
            patch: { status: 'retired', retiredReason: 'gone' },
          },
        },
        actionId: 'act_u1',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'char_1')).embeddingStale).toBe(0) // non-embedded columns don't flip

    await applyDeltaAction(
      {
        action: {
          kind: 'updateEntity',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'char_1', patch: { name: 'Kael' } },
        },
        actionId: 'act_u2',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'char_1')).embeddingStale).toBe(0) // same value re-sent compares equal

    await applyDeltaAction(
      {
        action: {
          kind: 'updateEntity',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'char_1', patch: { description: 'new text' } },
        },
        actionId: 'act_u3',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'char_1')).embeddingStale).toBe(1) // embedded column changed
  })

  it('writes keywords and priority, and leaves the vector alone', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createEntity', source: 'user_edit', payload: { entry: CHAR } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    // Clear the create-time dirty flag so the assertion below reads this edit only.
    await db.update(entities).set({ embeddingStale: 0 }).where(eq(entities.id, 'char_1'))

    await applyDeltaAction(
      {
        action: {
          kind: 'updateEntity',
          source: 'user_edit',
          payload: {
            branchId: 'br_1',
            id: 'char_1',
            patch: { keywords: ['the grey wolf'], priority: 4 },
          },
        },
        actionId: 'act_u',
        branchId: 'br_1',
      },
      ctx,
    )

    // UPDATABLE is a silent allowlist: a column missing from it leaves `set` empty
    // and the handler rejects, so this is what pins both new entries.
    const row = await rowFor(db, 'char_1')
    expect(row.keywords).toEqual(['the grey wolf'])
    expect(row.priority).toBe(4)
    // keywords is not in KIND_FIELDS.entity: re-embedding on an alias edit is pure cost.
    expect(row.embeddingStale).toBe(0)
    expect(entitiesStore.getById('br_1', 'char_1')?.keywords).toEqual(['the grey wolf'])
  })

  // user-precedence.ts reads an update's undo payload keys as the columns the user wrote.
  it('records only the columns a patch changes', async () => {
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
          kind: 'updateEntity',
          source: 'user_edit',
          payload: {
            branchId: 'br_1',
            id: 'char_1',
            patch: { status: 'active', name: 'Kael the Grey' },
          },
        },
        actionId: 'act_u',
        branchId: 'br_1',
      },
      ctx,
    )
    const [delta] = await db.select().from(deltas).where(eq(deltas.actionId, 'act_u'))
    expect(delta.undoPayload).toEqual({ name: 'Kael' })
    expect((await rowFor(db, 'char_1')).name).toBe('Kael the Grey')
  })

  it('no-ops a patch whose every column matches the row, writing no delta', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'createEntity',
          source: 'user_edit',
          payload: { entry: { ...CHAR, keywords: ['the knight'] } },
        },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    const result = await applyDeltaAction(
      {
        action: {
          kind: 'updateEntity',
          source: 'user_edit',
          payload: {
            branchId: 'br_1',
            id: 'char_1',
            patch: {
              status: 'active',
              keywords: ['the knight'],
              state: structuredClone(CHAR.state) as EntityState,
            },
          },
        },
        actionId: 'act_u',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result).toEqual({ status: 'rejected', reason: 'no-op entity patch', code: 'noop' })
    expect((await db.select().from(deltas)).length).toBe(1)
  })
})

const loc = (id: string, parent: string | null): NewEntity => ({
  id,
  branchId: 'br_1',
  kind: 'location',
  name: id,
  status: 'active',
  injectionMode: 'auto',
  state: { parent_location_id: parent },
  createdAt: 1,
  updatedAt: 1,
})

const setState = (
  id: string,
  state: Record<string, unknown>,
  actionId: string,
  source: 'user_edit' | 'ai_classifier' = 'user_edit',
) => ({
  action: {
    kind: 'updateEntity' as const,
    source,
    payload: { branchId: 'br_1', id, patch: { state: state as EntityState } },
  },
  actionId,
  branchId: 'br_1',
})

describe('parent_location_id cycle guard', () => {
  it('refuses A → B when B → A with parent-cycle, writing nothing', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values([loc('loc_a', null), loc('loc_b', 'loc_a')])
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const result = await applyDeltaAction(
      setState('loc_a', { parent_location_id: 'loc_b' }, 'act_1'),
      ctx,
    )
    expect(result).toMatchObject({
      status: 'rejected',
      reason: 'parent-cycle',
      code: 'parent-cycle',
    })
    expect((await rowFor(db, 'loc_a')).state).toEqual({ parent_location_id: null })
    expect(await db.select().from(deltas)).toHaveLength(0)
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it('refuses a self-parent on update and on create', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values([loc('loc_a', null)])
    expect(
      await applyDeltaAction(setState('loc_a', { parent_location_id: 'loc_a' }, 'act_1'), ctx),
    ).toMatchObject({ status: 'rejected', code: 'parent-cycle' })
    const created = await applyDeltaAction(
      {
        action: {
          kind: 'createEntity',
          source: 'user_edit',
          payload: { entry: loc('loc_n', 'loc_n') },
        },
        actionId: 'act_2',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(created).toMatchObject({ status: 'rejected', code: 'parent-cycle' })
    expect(await rowFor(db, 'loc_n')).toBeUndefined()
  })

  it('refuses the classifier the same way — the guard lives in the handler', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values([loc('loc_a', null), loc('loc_b', 'loc_a')])
    const result = await applyDeltaAction(
      setState('loc_a', { parent_location_id: 'loc_b' }, 'act_1', 'ai_classifier'),
      ctx,
    )
    expect(result).toMatchObject({ status: 'rejected', code: 'parent-cycle' })
  })

  it('accepts a parent that does not loop', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values([loc('loc_city', null), loc('loc_shop', null)])
    const result = await applyDeltaAction(
      setState('loc_shop', { parent_location_id: 'loc_city' }, 'act_1'),
      ctx,
    )
    expect(result.status).toBe('ok')
    expect((await rowFor(db, 'loc_shop')).state).toEqual({ parent_location_id: 'loc_city' })
  })

  it('does not re-walk an unchanged parent, so an existing loop never blocks an edit', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values([loc('loc_x', 'loc_y'), loc('loc_y', 'loc_x')])
    const result = await applyDeltaAction(
      setState('loc_x', { parent_location_id: 'loc_y', condition: 'flooded' }, 'act_1'),
      ctx,
    )
    expect(result.status).toBe('ok')
  })

  // The proposed parent isn't the fault: a loop already stored above it is.
  it('logs a cap hit on an existing loop at error and refuses it as a broken chain', async () => {
    const { db, ctx } = await setup()
    await db
      .insert(entities)
      .values([loc('loc_x', 'loc_y'), loc('loc_y', 'loc_x'), loc('loc_c', null)])
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const result = await applyDeltaAction(
      setState('loc_c', { parent_location_id: 'loc_x' }, 'act_1'),
      ctx,
    )
    expect(result).toMatchObject({ status: 'rejected', code: 'parent-chain-broken' })
    expect(error).toHaveBeenCalledWith('action_layer.parent_chain_cap_hit', {
      branchId: 'br_1',
      id: 'loc_c',
      parentId: 'loc_x',
    })
    error.mockRestore()
  })
})

// data-model.md → LocationState shape: nothing active or staged sits inside a retired place. The
// builders refuse first; the create handler is the backstop for a machine writer that doesn't.
describe('a retired parent on create', () => {
  const create = (entry: NewEntity) => ({
    action: {
      kind: 'createEntity' as const,
      source: 'piggyback_tagged_block' as const,
      payload: { entry },
    },
    actionId: 'act_1',
    branchId: 'br_1',
  })

  it('refuses a place that is not retired under a retired parent, writing nothing', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values([{ ...loc('loc_sunk', null), status: 'retired' }])
    expect(await applyDeltaAction(create(loc('loc_new', 'loc_sunk')), ctx)).toMatchObject({
      status: 'rejected',
      reason: 'retired-parent',
      code: 'retired-parent',
    })
    expect(await rowFor(db, 'loc_new')).toBeUndefined()
    expect(
      await applyDeltaAction(create({ ...loc('loc_staged', 'loc_sunk'), status: 'staged' }), ctx),
    ).toMatchObject({ status: 'rejected', code: 'retired-parent' })
  })

  it('accepts a retired place under a retired parent', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values([{ ...loc('loc_sunk', null), status: 'retired' }])
    const result = await applyDeltaAction(
      create({ ...loc('loc_ruin', 'loc_sunk'), status: 'retired' }),
      ctx,
    )
    expect(result.status).toBe('ok')
  })

  it('accepts a place under an active parent', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values([loc('loc_town', null)])
    expect((await applyDeltaAction(create(loc('loc_new', 'loc_town')), ctx)).status).toBe('ok')
  })
})

type EntityPatch = PipelineActionMap['updateEntity']['payload']['patch']

const patchChar = (patch: EntityPatch, actionId: string) => ({
  action: {
    kind: 'updateEntity' as const,
    source: 'user_edit' as const,
    payload: { branchId: 'br_1', id: 'char_1', patch },
  },
  actionId,
  branchId: 'br_1',
})

describe('collision flag columns', () => {
  const FLAGGED = {
    ...CHAR,
    nameCollisionFlag: 1,
    nameCollisionPartnerId: 'char_2',
    nameCollisionReason: 'distinct',
  } satisfies NewEntity
  const CLEAR = {
    nameCollisionFlag: 0,
    nameCollisionPartnerId: null,
    nameCollisionReason: null,
  } as const

  async function seedChar(ctx: Awaited<ReturnType<typeof setup>>['ctx'], entry: NewEntity) {
    return applyDeltaAction(
      {
        action: { kind: 'createEntity', source: 'user_edit', payload: { entry } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
  }

  const deltasOf = (db: Awaited<ReturnType<typeof setup>>['db'], actionId: string) =>
    db.select().from(deltas).where(eq(deltas.actionId, actionId))

  async function flagColumns(db: Awaited<ReturnType<typeof setup>>['db'], id: string) {
    const row = await rowFor(db, id)
    return [row.nameCollisionFlag, row.nameCollisionPartnerId, row.nameCollisionReason]
  }

  function storeFlagColumns(id: string) {
    const row = entitiesStore.getById('br_1', id)
    return [row?.nameCollisionFlag, row?.nameCollisionPartnerId, row?.nameCollisionReason]
  }

  it('creates a flagged row with its partner and reason, in the DB and the store', async () => {
    const { db, ctx } = await setup()

    expect(await seedChar(ctx, FLAGGED)).toMatchObject({ status: 'ok' })

    expect(await flagColumns(db, 'char_1')).toEqual([1, 'char_2', 'distinct'])
    expect(storeFlagColumns('char_1')).toEqual([1, 'char_2', 'distinct'])
  })

  it('creates an unflagged row with no partner or reason when the entry omits them', async () => {
    const { db, ctx } = await setup()

    expect(await seedChar(ctx, CHAR)).toMatchObject({ status: 'ok' })

    expect(await flagColumns(db, 'char_1')).toEqual([0, null, null])
    expect(storeFlagColumns('char_1')).toEqual([0, null, null])
  })

  // The partner stays out of REF_COLUMNS: a flag naming a gone row is dormant, not refused.
  it('accepts a flagged create whose partner the branch does not have', async () => {
    const { db, ctx } = await setup()

    const result = await seedChar(ctx, { ...FLAGGED, nameCollisionPartnerId: 'char_gone' })

    expect(result).toMatchObject({ status: 'ok' })
    expect(await flagColumns(db, 'char_1')).toEqual([1, 'char_gone', 'distinct'])
  })

  it.each([
    [
      'a flag with no partner',
      { nameCollisionPartnerId: null },
      'a flagged entity needs a collision partner',
    ],
    [
      'a flag with an empty partner',
      { nameCollisionPartnerId: '' },
      'a flagged entity needs a collision partner',
    ],
    [
      'a flag with no reason',
      { nameCollisionReason: null },
      'a flagged entity needs a collision reason, got null',
    ],
    [
      'a flag with an unknown reason',
      { nameCollisionReason: 'similar' as never },
      'a flagged entity needs a collision reason, got similar',
    ],
    [
      'no flag with a partner',
      { nameCollisionFlag: 0, nameCollisionReason: null },
      'an unflagged entity has no collision partner or reason',
    ],
    [
      'no flag with a reason',
      { nameCollisionFlag: 0, nameCollisionPartnerId: null },
      'an unflagged entity has no collision partner or reason',
    ],
    ['a flag of 2', { nameCollisionFlag: 2 }, 'nameCollisionFlag must be 0 or 1, got 2'],
    [
      'a flag naming the row itself',
      { nameCollisionPartnerId: 'char_1' },
      'an entity cannot be its own collision partner',
    ],
  ] as const)('refuses a create with %s, writing nothing', async (_label, overrides, reason) => {
    const { db, ctx } = await setup()

    expect(await seedChar(ctx, { ...FLAGGED, ...overrides })).toEqual({
      status: 'rejected',
      reason: `invalid entity: ${reason}`,
    })

    expect(await rowFor(db, 'char_1')).toBeUndefined()
    expect(await db.select().from(deltas)).toHaveLength(0)
    expect(entitiesStore.getById('br_1', 'char_1')).toBeUndefined()
  })

  it('clears all three in one delta whose reversal re-flags, without dirtying the vector', async () => {
    const { db, ctx } = await setup()
    await seedChar(ctx, { ...FLAGGED, embeddingStale: 0 })

    const result = await applyDeltaAction(patchChar(CLEAR, 'act_keep'), ctx)

    expect(result).toMatchObject({ status: 'ok' })
    expect(await flagColumns(db, 'char_1')).toEqual([0, null, null])
    expect(storeFlagColumns('char_1')).toEqual([0, null, null])
    expect((await rowFor(db, 'char_1')).embeddingStale).toBe(0)
    const logged = await deltasOf(db, 'act_keep')
    expect(logged).toHaveLength(1)
    // chapter-close.md → 3f: the clear names the pair it answered in a key no reversal rewrites.
    expect(logged[0].undoPayload).toEqual({
      nameCollisionFlag: 1,
      nameCollisionPartnerId: 'char_2',
      nameCollisionReason: 'distinct',
      $resolvedPair: 'char_2',
    })

    expect(await reverseReplayDeltas('act_keep', ctx)).toBe(1)
    expect(await flagColumns(db, 'char_1')).toEqual([1, 'char_2', 'distinct'])
    expect(storeFlagColumns('char_1')).toEqual([1, 'char_2', 'distinct'])
  })

  it('carries a rename and the clear as one delta', async () => {
    const { db, ctx } = await setup()
    await seedChar(ctx, FLAGGED)

    await applyDeltaAction(patchChar({ name: 'Kaelin', ...CLEAR }, 'act_rename'), ctx)

    const logged = await deltasOf(db, 'act_rename')
    expect(logged).toHaveLength(1)
    expect(logged[0].undoPayload).toEqual({
      name: 'Kael',
      nameCollisionFlag: 1,
      nameCollisionPartnerId: 'char_2',
      nameCollisionReason: 'distinct',
      $resolvedPair: 'char_2',
    })
    expect((await rowFor(db, 'char_1')).name).toBe('Kaelin')
    expect(await flagColumns(db, 'char_1')).toEqual([0, null, null])
  })

  it('drops a clear on an unflagged row, so a clear-only patch is the noop refusal', async () => {
    const { db, ctx } = await setup()
    await seedChar(ctx, CHAR)

    const result = await applyDeltaAction(patchChar(CLEAR, 'act_keep'), ctx)

    expect(result).toEqual({ status: 'rejected', reason: 'no-op entity patch', code: 'noop' })
    expect(await db.select().from(deltas)).toHaveLength(1)
  })

  it('re-points a flagged row in one delta whose reversal restores the old partner', async () => {
    const { db, ctx } = await setup()
    await seedChar(ctx, FLAGGED)

    const result = await applyDeltaAction(
      patchChar({ nameCollisionPartnerId: 'char_3' }, 'act_point'),
      ctx,
    )

    expect(result).toMatchObject({ status: 'ok' })
    expect(await flagColumns(db, 'char_1')).toEqual([1, 'char_3', 'distinct'])
    expect(storeFlagColumns('char_1')).toEqual([1, 'char_3', 'distinct'])
    const logged = await deltasOf(db, 'act_point')
    expect(logged).toHaveLength(1)
    expect(logged[0].undoPayload).toEqual({ nameCollisionPartnerId: 'char_2' })

    expect(await reverseReplayDeltas('act_point', ctx)).toBe(1)
    expect(await flagColumns(db, 'char_1')).toEqual([1, 'char_2', 'distinct'])
    expect(storeFlagColumns('char_1')).toEqual([1, 'char_2', 'distinct'])
  })

  it('re-points with the new reason in one delta whose reversal restores both', async () => {
    const { db, ctx } = await setup()
    await seedChar(ctx, FLAGGED)

    const result = await applyDeltaAction(
      patchChar({ nameCollisionPartnerId: 'char_3', nameCollisionReason: 'in-scene' }, 'act_both'),
      ctx,
    )

    expect(result).toMatchObject({ status: 'ok' })
    expect(await flagColumns(db, 'char_1')).toEqual([1, 'char_3', 'in-scene'])
    expect(storeFlagColumns('char_1')).toEqual([1, 'char_3', 'in-scene'])
    const logged = await deltasOf(db, 'act_both')
    expect(logged).toHaveLength(1)
    expect(logged[0].undoPayload).toEqual({
      nameCollisionPartnerId: 'char_2',
      nameCollisionReason: 'distinct',
    })

    expect(await reverseReplayDeltas('act_both', ctx)).toBe(1)
    expect(await flagColumns(db, 'char_1')).toEqual([1, 'char_2', 'distinct'])
    expect(storeFlagColumns('char_1')).toEqual([1, 'char_2', 'distinct'])
  })

  it('folds a re-point into a state patch as one delta', async () => {
    const { db, ctx } = await setup()
    await seedChar(ctx, FLAGGED)
    const state = { ...CHAR.state, traits: ['wary'] } as EntityState

    const result = await applyDeltaAction(
      patchChar({ state, nameCollisionPartnerId: 'char_3' }, 'act_fold'),
      ctx,
    )

    expect(result).toMatchObject({ status: 'ok' })
    const row = await rowFor(db, 'char_1')
    expect(row.state).toMatchObject({ traits: ['wary'] })
    expect(await flagColumns(db, 'char_1')).toEqual([1, 'char_3', 'distinct'])
    const logged = await deltasOf(db, 'act_fold')
    expect(logged).toHaveLength(1)
    expect(Object.keys(logged[0].undoPayload ?? {}).sort()).toEqual([
      'nameCollisionPartnerId',
      'state',
    ])
  })

  // A cast slips these past the patch type, and no type knows whether the row is flagged.
  it.each([
    [
      'a re-point of an unflagged row',
      CHAR,
      { nameCollisionPartnerId: 'char_3' },
      'only a flagged entity has a partner to re-point',
    ],
    [
      'the flag alone',
      FLAGGED,
      { nameCollisionFlag: 0 },
      'collision flag columns take only a clear or a partner re-point',
    ],
    [
      'a flag set',
      CHAR,
      { nameCollisionFlag: 1 },
      'collision flag columns take only a clear or a partner re-point',
    ],
    [
      'a nulled partner alone',
      FLAGGED,
      { nameCollisionPartnerId: null },
      'collision flag columns take only a clear or a partner re-point',
    ],
    [
      'a reason alone',
      FLAGGED,
      { nameCollisionReason: 'alike' },
      'collision flag columns take only a clear or a partner re-point',
    ],
    [
      'a re-point with a reason outside the set',
      FLAGGED,
      { nameCollisionPartnerId: 'char_3', nameCollisionReason: 'bogus' },
      'collision flag columns take only a clear or a partner re-point',
    ],
    [
      'a re-point with a nulled reason',
      FLAGGED,
      { nameCollisionPartnerId: 'char_3', nameCollisionReason: null },
      'collision flag columns take only a clear or a partner re-point',
    ],
    [
      'a re-point that names the flag as well',
      FLAGGED,
      { nameCollisionFlag: 0, nameCollisionPartnerId: 'char_3', nameCollisionReason: 'alike' },
      'collision flag columns take only a clear or a partner re-point',
    ],
    [
      'an empty partner',
      FLAGGED,
      { nameCollisionPartnerId: '' },
      'collision flag columns take only a clear or a partner re-point',
    ],
    [
      'a clear with a partner',
      FLAGGED,
      { ...CLEAR, nameCollisionPartnerId: 'char_3' },
      'collision flag columns take only a clear or a partner re-point',
    ],
    [
      'a re-point at the row itself',
      FLAGGED,
      { nameCollisionPartnerId: 'char_1' },
      'an entity cannot be its own collision partner',
    ],
    [
      'a present-but-undefined partner',
      FLAGGED,
      { name: 'Kaelin', nameCollisionPartnerId: undefined },
      'nameCollisionPartnerId is undefined',
    ],
  ] as const)('refuses %s, writing nothing', async (_label, seed, patch, reason) => {
    const { db, ctx } = await setup()
    await seedChar(ctx, seed)
    const before = await rowFor(db, 'char_1')

    expect(
      await applyDeltaAction(patchChar(patch as unknown as EntityPatch, 'act_bad'), ctx),
    ).toEqual({
      status: 'rejected',
      reason: `invalid entity patch: ${reason}`,
    })

    expect(await rowFor(db, 'char_1')).toEqual(before)
    expect(await db.select().from(deltas)).toHaveLength(1)
  })

  // edge-cases.md → Schema: the migration's CHECK holds even for a write that skips the handlers.
  describe.each([
    ['a flag with no partner', { nameCollisionFlag: 1, nameCollisionReason: 'distinct' }],
    [
      'a flag with a partner but no reason',
      { nameCollisionFlag: 1, nameCollisionPartnerId: 'char_2' },
    ],
    ['no flag with a partner', { nameCollisionFlag: 0, nameCollisionPartnerId: 'char_2' }],
    ['no flag with a reason', { nameCollisionFlag: 0, nameCollisionReason: 'distinct' }],
  ] as const)('the CHECK refuses %s', (_label, columns) => {
    const refusal = 'CHECK constraint failed: entities_name_collision_pair'

    it('on insert', async () => {
      const { db, ctx } = await setup()
      await seedChar(ctx, CHAR)

      await expect(
        ctx.runInTransaction([
          db
            .insert(entities)
            .values({ ...CHAR, id: 'char_9', ...columns })
            .toSQL(),
        ]),
      ).rejects.toThrow(refusal)

      expect(await rowFor(db, 'char_9')).toBeUndefined()
    })

    it('on update', async () => {
      const { db, ctx } = await setup()
      await seedChar(ctx, CHAR)

      await expect(
        ctx.runInTransaction([
          db.update(entities).set(columns).where(eq(entities.id, 'char_1')).toSQL(),
        ]),
      ).rejects.toThrow(refusal)

      expect(await flagColumns(db, 'char_1')).toEqual([0, null, null])
    })
  })
})

describe('the lead flag', () => {
  type Harness = Awaited<ReturnType<typeof setup>>
  type Source = PipelineActionMap['updateEntity']['source']

  const setLead = (isLead: 0 | 1, source: Source, actionId: string) => ({
    action: {
      kind: 'updateEntity' as const,
      source,
      payload: { branchId: 'br_1', id: 'char_1', patch: { isLead } },
    },
    actionId,
    branchId: 'br_1',
  })

  async function seedChar(ctx: Harness['ctx'], entry: NewEntity = CHAR) {
    return applyDeltaAction(
      {
        action: { kind: 'createEntity', source: 'user_edit', payload: { entry } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
  }

  const deltasOf = (db: Harness['db'], actionId: string) =>
    db.select().from(deltas).where(eq(deltas.actionId, actionId))

  it('creates a row unflagged, in the DB and the store', async () => {
    const { db, ctx } = await setup()

    await seedChar(ctx)

    expect((await rowFor(db, 'char_1')).isLead).toBe(0)
    expect(entitiesStore.getById('br_1', 'char_1')?.isLead).toBe(0)
  })

  it('takes the flag from a user edit, its undo the prior value, the vector left alone', async () => {
    const { db, ctx } = await setup()
    await seedChar(ctx, { ...CHAR, embeddingStale: 0 })

    expect(await applyDeltaAction(setLead(1, 'user_edit', 'act_set'), ctx)).toMatchObject({
      status: 'ok',
    })

    const row = await rowFor(db, 'char_1')
    expect([row.isLead, row.embeddingStale]).toEqual([1, 0])
    expect(entitiesStore.getById('br_1', 'char_1')?.isLead).toBe(1)
    expect((await deltasOf(db, 'act_set')).map((d) => [d.source, d.op, d.undoPayload])).toEqual([
      ['user_edit', 'update', { isLead: 0 }],
    ])

    expect(await reverseReplayDeltas('act_set', ctx)).toBe(1)
    expect((await rowFor(db, 'char_1')).isLead).toBe(0)
    expect(entitiesStore.getById('br_1', 'char_1')?.isLead).toBe(0)
  })

  // data-model.md → The lead: no machine writer touches the flag, not even to restate it.
  it.each([
    ['periodic_classifier', 1],
    ['per_turn_classifier', 1],
    ['chapter_close', 1],
    ['periodic_classifier', 0],
  ] as const)('refuses isLead from %s (isLead %i), writing nothing', async (source, isLead) => {
    const { db, ctx } = await setup()
    await seedChar(ctx)
    const before = await rowFor(db, 'char_1')

    expect(await applyDeltaAction(setLead(isLead, source, 'act_machine'), ctx)).toEqual({
      status: 'rejected',
      reason: 'invalid entity patch: only a user edit writes isLead',
    })

    expect(await rowFor(db, 'char_1')).toEqual(before)
    expect(entitiesStore.getById('br_1', 'char_1')?.isLead).toBe(0)
    expect(await deltasOf(db, 'act_machine')).toEqual([])
  })

  it('refuses a lead flag on a location as a rejection, not the CHECK, writing nothing', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'createEntity',
          source: 'user_edit',
          payload: { entry: loc('loc_1', null) },
        },
        actionId: 'act_loc',
        branchId: 'br_1',
      },
      ctx,
    )

    const result = await applyDeltaAction(
      {
        action: {
          kind: 'updateEntity',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'loc_1', patch: { isLead: 1 } },
        },
        actionId: 'act_lead_loc',
        branchId: 'br_1',
      },
      ctx,
    )

    expect(result).toEqual({
      status: 'rejected',
      reason: 'invalid entity patch: only a character can be the lead',
    })
    expect((await rowFor(db, 'loc_1')).isLead).toBe(0)
    expect(entitiesStore.getById('br_1', 'loc_1')?.isLead).toBe(0)
    expect(await deltasOf(db, 'act_lead_loc')).toEqual([])
  })

  it.each(['user_edit', 'periodic_classifier'] as const)(
    'refuses a %s create that carries the flag, writing nothing',
    async (source) => {
      const { db, ctx } = await setup()

      const result = await applyDeltaAction(
        {
          action: { kind: 'createEntity', source, payload: { entry: { ...CHAR, isLead: 1 } } },
          actionId: 'act_c',
          branchId: 'br_1',
        },
        ctx,
      )

      expect(result).toEqual({
        status: 'rejected',
        reason: 'invalid entity: a create never sets isLead',
      })
      expect(await rowFor(db, 'char_1')).toBeUndefined()
      expect(await db.select().from(deltas)).toHaveLength(0)
      expect(entitiesStore.getById('br_1', 'char_1')).toBeUndefined()
    },
  )

  it('refuses a flag other than 0 or 1 at parse, writing nothing', async () => {
    const { db, ctx } = await setup()
    await seedChar(ctx)
    const before = await rowFor(db, 'char_1')

    const result = await applyDeltaAction(
      {
        action: {
          kind: 'updateEntity',
          source: 'user_edit',
          payload: {
            branchId: 'br_1',
            id: 'char_1',
            patch: { isLead: 2 } as unknown as { isLead: 0 | 1 },
          },
        },
        actionId: 'act_two',
        branchId: 'br_1',
      },
      ctx,
    )

    expect(result).toMatchObject({
      status: 'rejected',
      reason: expect.stringMatching(/^invalid entity patch: /),
    })
    expect(await rowFor(db, 'char_1')).toEqual(before)
    expect(await deltasOf(db, 'act_two')).toEqual([])
  })

  it('deletes a flagged row with the flag in its undo payload, and the reversal restores it', async () => {
    const { db, ctx } = await setup()
    await seedChar(ctx)
    await applyDeltaAction(setLead(1, 'user_edit', 'act_set'), ctx)

    expect(
      await applyDeltaAction(
        {
          action: {
            kind: 'deleteEntity',
            source: 'user_edit',
            payload: { branchId: 'br_1', id: 'char_1' },
          },
          actionId: 'act_d',
          branchId: 'br_1',
        },
        ctx,
      ),
    ).toMatchObject({ status: 'ok' })

    expect(await rowFor(db, 'char_1')).toBeUndefined()
    const [deleted] = await deltasOf(db, 'act_d')
    expect(deleted?.undoPayload).toMatchObject({ id: 'char_1', isLead: 1 })

    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    expect((await rowFor(db, 'char_1')).isLead).toBe(1)
    expect(entitiesStore.getById('br_1', 'char_1')?.isLead).toBe(1)
  })
})

// Entity ids repeat across branches (the key is branch and id), so every read and write is scoped.
describe('branch scope', () => {
  type BranchId = 'br_1' | 'br_2'

  const SIBLING: Entity = {
    id: 'char_1',
    branchId: 'br_1',
    kind: 'character',
    name: 'Kael',
    description: 'a wandering knight',
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    nameCollisionFlag: 0,
    nameCollisionPartnerId: null,
    nameCollisionReason: null,
    state: {
      visual: { attire: 'cloak' },
      traits: ['brave'],
      drives: [],
      current_location_id: 'loc_1',
      equipped_items: [],
      inventory: [],
      stackables: { gold: 5 },
      faction_id: null,
      lastSeenAt: null,
    },
    tags: ['knight'],
    keywords: ['kael'],
    priority: 3,
    embeddingStale: 0,
    isLead: 0,
    createdAt: 1,
    updatedAt: 1,
  }
  // Stale already: an update and any reversal stamp embedding_stale 1.
  const WRITTEN: Entity = {
    id: 'char_1',
    branchId: 'br_2',
    kind: 'character',
    name: 'Kael the Exile',
    description: 'a knight cast out',
    status: 'retired',
    retiredReason: 'exiled',
    injectionMode: 'always',
    nameCollisionFlag: 1,
    nameCollisionPartnerId: 'char_2',
    nameCollisionReason: 'alike',
    state: {
      visual: { attire: 'rags' },
      traits: ['bitter'],
      drives: ['go home'],
      current_location_id: 'loc_2',
      equipped_items: [],
      inventory: ['item_sword'],
      stackables: { gold: 1 },
      faction_id: null,
      lastSeenAt: null,
    },
    tags: ['exile'],
    keywords: ['the exile'],
    priority: 5,
    embeddingStale: 1,
    isLead: 0,
    createdAt: 2,
    updatedAt: 2,
  }
  const SIBLING_INV: HappeningInvolvement = {
    id: 'hinv_1',
    branchId: 'br_1',
    happeningId: 'hap_1',
    entityId: 'char_1',
    role: 'witness',
  }
  const WRITTEN_INV: HappeningInvolvement = { ...SIBLING_INV, branchId: 'br_2', role: 'duelist' }
  const SIBLING_AW: HappeningAwareness = {
    id: 'haw_1',
    branchId: 'br_1',
    happeningId: 'hap_1',
    characterId: 'char_1',
    learnedAtEntryId: 'entry_1',
    decayResistance: 0.9,
    retrievalCount: 9,
    source: 'a letter',
  }
  const WRITTEN_AW: HappeningAwareness = {
    ...SIBLING_AW,
    branchId: 'br_2',
    learnedAtEntryId: 'entry_2',
    decayResistance: 0.3,
    retrievalCount: 4,
    source: 'overheard',
  }
  const SIBLING_REL: CharacterRelationship = {
    id: 'rel_1',
    branchId: 'br_1',
    aId: 'char_1',
    bId: 'char_2',
    kind: 'ally',
    inverseKind: null,
    createdAt: 1,
    updatedAt: 1,
  }
  const WRITTEN_REL: CharacterRelationship = {
    ...SIBLING_REL,
    branchId: 'br_2',
    kind: 'rival',
    inverseKind: 'wary',
    createdAt: 2,
    updatedAt: 2,
  }
  const siblingChildren = {
    involvements: [SIBLING_INV],
    awareness: [SIBLING_AW],
    relationships: [SIBLING_REL],
  }
  const writtenChildren = {
    involvements: [WRITTEN_INV],
    awareness: [WRITTEN_AW],
    relationships: [WRITTEN_REL],
  }
  const partner = (branchId: BranchId): NewEntity => ({
    id: 'char_2',
    branchId,
    kind: 'character',
    name: 'Mira',
    status: 'active',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
  })
  const fire = (branchId: BranchId): NewHappening => ({
    id: 'hap_1',
    branchId,
    title: 'The fire',
    createdAt: 1,
    updatedAt: 1,
  })

  type Harness = Awaited<ReturnType<typeof setup>>

  // An id-only read scans in insertion order, so sibling rows go in first. The delete's reversal
  // restores the involvement, awareness and relationship rows, checking the happenings they name.
  async function twoBranches({ written = true }: { written?: boolean } = {}) {
    const harness = await setup()
    registerHappenings()
    registerHappeningInvolvements()
    registerHappeningAwareness()
    registerCharacterRelationships()
    const { db } = harness
    await db.insert(branches).values({ id: 'br_2', storyId: 'story_1', name: 'fork', createdAt: 1 })
    await db
      .insert(entities)
      .values([SIBLING, partner('br_1'), ...(written ? [WRITTEN] : []), partner('br_2')])
    await db.insert(happenings).values([fire('br_1'), ...(written ? [fire('br_2')] : [])])
    await db.insert(happeningInvolvements).values([SIBLING_INV, ...(written ? [WRITTEN_INV] : [])])
    await db.insert(happeningAwareness).values([SIBLING_AW, ...(written ? [WRITTEN_AW] : [])])
    await db.insert(characterRelationships).values([SIBLING_REL, ...(written ? [WRITTEN_REL] : [])])
    return harness
  }

  const onWritten = (ctx: Harness['ctx'], action: PipelineAction, actionId: string) =>
    applyDeltaAction({ action, actionId, branchId: 'br_2' }, ctx)

  const entityOn = async (db: Harness['db'], branchId: BranchId, id: string) =>
    (
      await db
        .select()
        .from(entities)
        .where(and(eq(entities.branchId, branchId), eq(entities.id, id)))
    )[0]

  const childrenOn = async (db: Harness['db'], branchId: BranchId) => ({
    involvements: await db
      .select()
      .from(happeningInvolvements)
      .where(eq(happeningInvolvements.branchId, branchId)),
    awareness: await db
      .select()
      .from(happeningAwareness)
      .where(eq(happeningAwareness.branchId, branchId)),
    relationships: await db
      .select()
      .from(characterRelationships)
      .where(eq(characterRelationships.branchId, branchId)),
  })

  const loggedBy = (db: Harness['db'], actionId: string) =>
    db.select().from(deltas).where(eq(deltas.actionId, actionId))

  it("createEntity pair: creates beside the sibling's row and reverses", async () => {
    const { db, ctx } = await twoBranches({ written: false })
    const create: PipelineAction = {
      kind: 'createEntity',
      source: 'user_edit',
      payload: { entry: WRITTEN },
    }

    expect(await onWritten(ctx, create, 'act_c')).toMatchObject({ status: 'ok' })
    expect(await entityOn(db, 'br_2', 'char_1')).toEqual(WRITTEN)
    expect(await entityOn(db, 'br_1', 'char_1')).toEqual(SIBLING)

    expect(await reverseReplayDeltas('act_c', ctx)).toBe(1)
    expect(await entityOn(db, 'br_2', 'char_1')).toBeUndefined()
    expect(await entityOn(db, 'br_1', 'char_1')).toEqual(SIBLING)
  })

  it('updateEntity pair: updates from its own row and reverses', async () => {
    const { db, ctx } = await twoBranches()
    const patch = { name: 'Kael the Returned', description: 'a knight come home', priority: 7 }
    const update: PipelineAction = {
      kind: 'updateEntity',
      source: 'user_edit',
      payload: { branchId: 'br_2', id: 'char_1', patch },
    }

    expect(await onWritten(ctx, update, 'act_u')).toMatchObject({ status: 'ok' })
    expect(await entityOn(db, 'br_2', 'char_1')).toEqual({ ...WRITTEN, ...patch })
    const [logged] = await loggedBy(db, 'act_u')
    expect(logged.undoPayload).toEqual({
      name: 'Kael the Exile',
      description: 'a knight cast out',
      priority: 5,
    })
    expect(await entityOn(db, 'br_1', 'char_1')).toEqual(SIBLING)

    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    expect(await entityOn(db, 'br_2', 'char_1')).toEqual(WRITTEN)
    expect(await entityOn(db, 'br_1', 'char_1')).toEqual(SIBLING)
  })

  it('deleteEntity pair: deletes its own row and children and restores them', async () => {
    const { db, ctx } = await twoBranches()
    const remove: PipelineAction = {
      kind: 'deleteEntity',
      source: 'user_edit',
      payload: { branchId: 'br_2', id: 'char_1' },
    }

    expect(await onWritten(ctx, remove, 'act_d')).toMatchObject({ status: 'ok' })
    expect(await entityOn(db, 'br_2', 'char_1')).toBeUndefined()
    expect(await childrenOn(db, 'br_2')).toEqual({
      involvements: [],
      awareness: [],
      relationships: [],
    })
    const [logged] = await loggedBy(db, 'act_d')
    expect(logged.undoPayload).toEqual({ ...WRITTEN, ...writtenChildren, translations: [] })
    expect(await entityOn(db, 'br_1', 'char_1')).toEqual(SIBLING)
    expect(await childrenOn(db, 'br_1')).toEqual(siblingChildren)

    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    expect(await entityOn(db, 'br_2', 'char_1')).toEqual(WRITTEN)
    expect(await childrenOn(db, 'br_2')).toEqual(writtenChildren)
    expect(await entityOn(db, 'br_1', 'char_1')).toEqual(SIBLING)
    expect(await childrenOn(db, 'br_1')).toEqual(siblingChildren)
  })

  // The payload names the sibling, a valid target there: without the check the write lands on it.
  const PAYLOAD_CASES: { action: PipelineAction; reason: string }[] = [
    {
      action: {
        kind: 'createEntity',
        source: 'user_edit',
        payload: { entry: { ...SIBLING, id: 'char_9' } },
      },
      reason: 'branch mismatch: delta br_2 vs entry br_1',
    },
    {
      action: {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: { branchId: 'br_1', id: 'char_1', patch: { name: 'Kael the Returned' } },
      },
      reason: 'branch mismatch: delta br_2 vs target br_1',
    },
    {
      action: {
        kind: 'deleteEntity',
        source: 'user_edit',
        payload: { branchId: 'br_1', id: 'char_1' },
      },
      reason: 'branch mismatch: delta br_2 vs target br_1',
    },
  ]

  it.each(PAYLOAD_CASES.map((c) => [c.action.kind, c] as const))(
    '%s payload: refuses a payload naming the sibling branch',
    async (_kind, { action, reason }) => {
      const { db, ctx } = await twoBranches()

      expect(await onWritten(ctx, action, 'act_payload')).toEqual({ status: 'rejected', reason })

      expect(await entityOn(db, 'br_1', 'char_1')).toEqual(SIBLING)
      expect(await entityOn(db, 'br_2', 'char_1')).toEqual(WRITTEN)
      expect(await db.select().from(entities)).toHaveLength(4)
      expect(await childrenOn(db, 'br_1')).toEqual(siblingChildren)
      expect(await childrenOn(db, 'br_2')).toEqual(writtenChildren)
      expect(await loggedBy(db, 'act_payload')).toEqual([])
    },
  )

  // Each branch's row starts at its own flag value; a flag write must move only its own row.
  async function twoBranchesLeading(sibling: 0 | 1, written: 0 | 1) {
    const harness = await twoBranches()
    const { db } = harness
    await db.update(entities).set({ isLead: sibling }).where(eq(entities.branchId, 'br_1'))
    await db.update(entities).set({ isLead: written }).where(eq(entities.branchId, 'br_2'))
    return harness
  }

  const leadFlag = (isLead: 0 | 1): PipelineAction => ({
    kind: 'updateEntity',
    source: 'user_edit',
    payload: { branchId: 'br_2', id: 'char_1', patch: { isLead } },
  })

  it("updateEntity isLead pair: sets the flag from its own branch's row, and the reversal clears only that row", async () => {
    const { db, ctx } = await twoBranchesLeading(1, 0)

    expect(await onWritten(ctx, leadFlag(1), 'act_set')).toMatchObject({ status: 'ok' })
    const [logged] = await loggedBy(db, 'act_set')
    expect(logged.undoPayload).toEqual({ isLead: 0 })
    expect(await entityOn(db, 'br_2', 'char_1')).toEqual({ ...WRITTEN, isLead: 1 })
    expect(await entityOn(db, 'br_1', 'char_1')).toEqual({ ...SIBLING, isLead: 1 })

    expect(await reverseReplayDeltas('act_set', ctx)).toBe(1)
    expect(await entityOn(db, 'br_2', 'char_1')).toEqual({ ...WRITTEN, isLead: 0 })
    expect(await entityOn(db, 'br_1', 'char_1')).toEqual({ ...SIBLING, isLead: 1 })
  })

  it("updateEntity isLead pair: clears the flag on its own branch's row only, and the reversal restores it", async () => {
    const { db, ctx } = await twoBranchesLeading(1, 1)

    expect(await onWritten(ctx, leadFlag(0), 'act_clear')).toMatchObject({ status: 'ok' })
    const [logged] = await loggedBy(db, 'act_clear')
    expect(logged.undoPayload).toEqual({ isLead: 1 })
    expect(await entityOn(db, 'br_2', 'char_1')).toEqual({ ...WRITTEN, isLead: 0 })
    expect(await entityOn(db, 'br_1', 'char_1')).toEqual({ ...SIBLING, isLead: 1 })

    expect(await reverseReplayDeltas('act_clear', ctx)).toBe(1)
    expect(await entityOn(db, 'br_2', 'char_1')).toEqual({ ...WRITTEN, isLead: 1 })
    expect(await entityOn(db, 'br_1', 'char_1')).toEqual({ ...SIBLING, isLead: 1 })
  })
})
