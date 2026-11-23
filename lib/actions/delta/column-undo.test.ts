import { and, desc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  branches,
  deltas,
  entities,
  stories,
  type CharacterState,
  type Delta,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entitiesStore } from '@/lib/stores'

import { reverseRows } from './__tests__/reverse-rows'
import { applyDeltaAction } from './apply-delta-action'
import { termMatchOf, undoneColumnOf } from './column-undo'
import type { DbCtx, PipelineAction } from '../types'

let ctx: DbCtx

const STATE: CharacterState = {
  visual: { attire: 'travel cloak' },
  traits: ['brave'],
  drives: [],
  voice: 'low and dry',
  current_location_id: null,
  equipped_items: [],
  inventory: [],
  faction_id: null,
  lastSeenAt: null,
}

const KAEL: NewEntity = {
  id: 'char_kael',
  branchId: 'b1',
  kind: 'character',
  name: 'Kael',
  description: 'a wandering knight',
  status: 'active',
  injectionMode: 'auto',
  keywords: ['the knight'],
  state: STATE,
  createdAt: 1,
  updatedAt: 1,
}

const place = (id: string, parent: string | null): NewEntity => ({
  id,
  branchId: 'b1',
  kind: 'location',
  name: id,
  status: 'active',
  injectionMode: 'auto',
  state: { parent_location_id: parent },
  createdAt: 1,
  updatedAt: 1,
})

const create = (entry: NewEntity): PipelineAction => ({
  kind: 'createEntity',
  source: 'user_edit',
  payload: { entry },
})

const update = (id: string, patch: Record<string, unknown>): PipelineAction => ({
  kind: 'updateEntity',
  source: 'user_edit',
  payload: { branchId: 'b1', id, patch },
})

beforeEach(async () => {
  const t = await createTestDb()
  ctx = { db: t.db, runInTransaction: t.runInTransaction }
  await ctx.db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await ctx.db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
})

afterEach(() => {
  entitiesStore.__reset()
})

async function act(actionId: string, action: PipelineAction): Promise<void> {
  const result = await applyDeltaAction({ action, actionId, branchId: 'b1' }, ctx)
  if (result.status !== 'ok') throw new Error(`${actionId} did not land: ${JSON.stringify(result)}`)
}

async function deltaOf(actionId: string): Promise<Delta> {
  const [delta] = (await ctx.db
    .select()
    .from(deltas)
    .where(and(eq(deltas.branchId, 'b1'), eq(deltas.actionId, actionId)))
    .orderBy(desc(deltas.logPosition))) as Delta[]
  return delta
}

async function columnOf(id: string, column: string): Promise<unknown> {
  const [row] = await ctx.db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, 'b1'), eq(entities.id, id)))
  return (row as Record<string, unknown>)[column]
}

// The wrapper over the column as it stands, then a real reversal of the same delta, read back.
async function wrapperAndReversal(actionId: string, column: string) {
  const delta = await deltaOf(actionId)
  const partial = (delta.undoPayload ?? {})[column]
  const wrapped = undoneColumnOf(
    delta.targetTable,
    column,
    partial,
    await columnOf(delta.targetId, column),
  )
  await reverseRows([delta], ctx)
  return { wrapped, reversed: await columnOf(delta.targetId, column) }
}

describe('undoneColumnOf', () => {
  it('steps a scalar column back to its prior value', async () => {
    await act('act_create', create(KAEL))
    await act('act_rename', update('char_kael', { name: 'Ser Kael' }))
    expect((await deltaOf('act_rename')).undoPayload).toEqual({ name: 'Kael' })

    expect(await wrapperAndReversal('act_rename', 'name')).toEqual({
      wrapped: 'Kael',
      reversed: 'Kael',
    })
  })

  it('overlays a state partial on the column as it stands', async () => {
    await act('act_create', create(KAEL))
    await act(
      'act_traits',
      update('char_kael', { state: { ...STATE, traits: ['brave', 'scarred'] } }),
    )
    expect((await deltaOf('act_traits')).undoPayload).toEqual({ state: { traits: ['brave'] } })

    expect(await wrapperAndReversal('act_traits', 'state')).toEqual({
      wrapped: STATE,
      reversed: STATE,
    })
  })

  // No handler logs a null state partial (null reads as the empty state), so it is set here.
  it('restores a null partial on state as a null column', async () => {
    await act('act_create', create(KAEL))
    await act(
      'act_traits',
      update('char_kael', { state: { ...STATE, traits: ['brave', 'scarred'] } }),
    )
    await ctx.db
      .update(deltas)
      .set({ undoPayload: { state: null } })
      .where(and(eq(deltas.branchId, 'b1'), eq(deltas.actionId, 'act_traits')))

    expect(await wrapperAndReversal('act_traits', 'state')).toEqual({
      wrapped: null,
      reversed: null,
    })
  })

  it('gives a parent-only partial on a place a ref clear unplaced its parent and drops the mark', async () => {
    await ctx.db
      .insert(entities)
      .values([place('loc_quarter', null), place('loc_docks', 'loc_quarter')])
    await act('act_varn', create(place('loc_varn', null)))
    await act('act_move', update('loc_docks', { state: { parent_location_id: 'loc_varn' } }))
    // Reversing Varn's create clears the docks' parent ref, logging nothing; the move survives.
    await reverseRows([await deltaOf('act_varn')], ctx)
    expect(await columnOf('loc_docks', 'state')).toEqual({
      parent_location_id: null,
      unplaced: true,
    })
    expect((await deltaOf('act_move')).undoPayload).toEqual({
      state: { parent_location_id: 'loc_quarter' },
    })

    expect(await wrapperAndReversal('act_move', 'state')).toEqual({
      wrapped: { parent_location_id: 'loc_quarter' },
      reversed: { parent_location_id: 'loc_quarter' },
    })
  })

  it('throws on an unregistered table', () => {
    expect(() => undoneColumnOf('no_such_table', 'name', 'a', 'b')).toThrow(
      'undoneColumnOf: no registered table "no_such_table"',
    )
  })
})

describe('termMatchOf', () => {
  it.each([
    ['entities', 'keywords', undefined, 'normalized'],
    ['entities', 'tags', undefined, 'normalized'],
    ['lore', 'keywords', undefined, 'normalized'],
    ['lore', 'tags', undefined, 'normalized'],
    ['entities', 'state', ['traits'], 'exact'],
    ['entities', 'state', ['drives'], 'exact'],
    ['entities', 'state', ['agenda'], 'exact'],
    ['entities', 'state', ['inventory'], 'exact'],
    ['entities', 'state', ['equipped_items'], 'exact'],
  ] as const)('reads %s.%s %j as %s', (table, column, path, match) => {
    expect(termMatchOf(table, column, path)).toBe(match)
  })

  it.each([
    ['entities', 'state', ['voice']],
    ['entities', 'state', undefined],
    ['entities', 'name', undefined],
    ['entities', 'keywords', ['traits']],
    ['threads', 'title', undefined],
  ] as const)('reads %s.%s %j as no term list', (table, column, path) => {
    expect(termMatchOf(table, column, path)).toBeUndefined()
  })

  it('throws on an unregistered table', () => {
    expect(() => termMatchOf('no_such_table', 'keywords')).toThrow(
      'termMatchOf: no registered table "no_such_table"',
    )
  })
})
