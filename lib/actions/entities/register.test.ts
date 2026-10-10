import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { branches, deltas, entities, stories, type EntityState, type NewEntity } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { logger } from '@/lib/diagnostics'
import { entitiesStore } from '@/lib/stores'

import type { PipelineActionMap } from '../action-map'
import { registerEntities } from './register'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'

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
    expect(entitiesStore.getById('char_1')?.kind).toBe('character')
    expect(entitiesStore.getById('char_1')?.state).toMatchObject({ visual: { attire: 'cloak' } })
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
    expect(entitiesStore.getEntities().get('char_1')?.name).toBe('Kael')
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
    expect(entitiesStore.getById('char_1')).toBeUndefined() // store no-op
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
    expect(entitiesStore.getById('char_1')?.state).toMatchObject({
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
    expect(entitiesStore.getById('char_1')?.state).toMatchObject({
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
    expect(entitiesStore.getById('char_1')).toBeUndefined()

    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    expect((await rowFor(db, 'char_1')).name).toBe('Kael')
    expect(entitiesStore.getById('char_1')?.name).toBe('Kael')
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
    expect(entitiesStore.getById('char_1')?.keywords).toEqual(['the grey wolf'])
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
    const row = entitiesStore.getById(id)
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
    expect(entitiesStore.getById('char_1')).toBeUndefined()
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
    expect(logged[0].undoPayload).toEqual({
      nameCollisionFlag: 1,
      nameCollisionPartnerId: 'char_2',
      nameCollisionReason: 'distinct',
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
      'a re-point with a reason',
      FLAGGED,
      { nameCollisionPartnerId: 'char_3', nameCollisionReason: 'alike' },
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
