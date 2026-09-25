import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { branches, deltas, entities, stories, type EntityState, type NewEntity } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { logger } from '@/lib/diagnostics'
import { entitiesStore } from '@/lib/stores'

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

  it('logs a cap hit on an existing loop at error and refuses', async () => {
    const { db, ctx } = await setup()
    await db
      .insert(entities)
      .values([loc('loc_x', 'loc_y'), loc('loc_y', 'loc_x'), loc('loc_c', null)])
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const result = await applyDeltaAction(
      setState('loc_c', { parent_location_id: 'loc_x' }, 'act_1'),
      ctx,
    )
    expect(result).toMatchObject({ status: 'rejected', code: 'parent-cycle' })
    expect(error).toHaveBeenCalledWith('action_layer.parent_chain_cap_hit', {
      branchId: 'br_1',
      id: 'loc_c',
      parentId: 'loc_x',
    })
    error.mockRestore()
  })
})
