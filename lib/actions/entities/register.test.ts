import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, deltas, entities, stories, type NewEntity } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
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
})
