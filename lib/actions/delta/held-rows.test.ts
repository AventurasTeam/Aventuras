import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { branches, deltas, stories, type Delta } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { logger } from '@/lib/diagnostics'

import { EMPTY_HELD_ROWS, heldKey, loadHeldRows, type HeldRowIndex } from './held-rows'
import type { RefTable } from './live-refs'
import type { DbCtx } from '../types'

let ctx: DbCtx

const delta = (
  id: string,
  logPosition: number,
  over: Partial<Delta> & Pick<Delta, 'targetTable' | 'targetId'>,
): Delta => ({
  id,
  branchId: 'b1',
  actionId: `act_${id}`,
  op: 'delete',
  entryId: null,
  source: 'user_edit',
  undoPayload: null,
  logPosition,
  encodingVersion: 1,
  createdAt: logPosition,
  ...over,
})

const kade = {
  id: 'char_k',
  branchId: 'b1',
  kind: 'character',
  name: 'Kade',
  status: 'active',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
}

const rel = {
  id: 'rel_1',
  branchId: 'b1',
  aId: 'char_k',
  bId: 'char_x',
  kind: 'ally',
  inverseKind: null,
  createdAt: 1,
  updatedAt: 1,
}

const translation = (id: string, targetKind: string, targetId: string) => ({
  id,
  branchId: 'b1',
  targetKind,
  targetId,
  field: 'name',
  language: 'es',
  translatedText: 'x',
  createdAt: 1,
  updatedAt: 1,
})

const trRel = translation('tr_rel', 'character_relationship', 'rel_1')
const trOwn = translation('tr_own', 'entity', 'char_k')

// An entity delete's payload as cascadedDelete writes it, re-logged once by a redo.
const entityPayload = {
  ...kade,
  involvements: [],
  awareness: [],
  relationships: [rel],
  translations: [trRel, trOwn],
  $firstLoggedAt: 2,
}

const entityDelete = delta('d_del', 3, {
  targetTable: 'entities',
  targetId: 'char_k',
  undoPayload: entityPayload,
})

async function insert(...rows: Delta[]): Promise<void> {
  await ctx.db.insert(deltas).values(rows)
}

const naming = (held: HeldRowIndex, table: RefTable, id: string) =>
  held
    .naming(table, id)
    .map((h) => `${h.place} ${h.table}:${h.id}`)
    .sort()

beforeEach(async () => {
  const t = await createTestDb()
  ctx = { db: t.db, runInTransaction: t.runInTransaction }
  await ctx.db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await ctx.db.insert(branches).values([
    { id: 'b1', storyId: 's1', name: 'main', createdAt: 1 },
    { id: 'b2', storyId: 's1', name: 'fork', createdAt: 1 },
  ])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('loadHeldRows', () => {
  it("indexes a delete's own row without its cascade or meta keys", async () => {
    await insert(entityDelete)

    const held = await loadHeldRows(ctx, 'b1')

    const target = held.byRow.get(heldKey('entities', 'char_k'))
    expect(target).toMatchObject({ table: 'entities', id: 'char_k', place: 'target' })
    expect(target?.holder.id).toBe('d_del')
    expect(target?.row).toEqual(kade)
  })

  it('indexes every captured child by its table and id', async () => {
    await insert(entityDelete)

    const held = await loadHeldRows(ctx, 'b1')

    expect([...held.byRow.keys()].sort()).toEqual([
      'character_relationships:rel_1',
      'entities:char_k',
      'translations:tr_own',
      'translations:tr_rel',
    ])
    const captured = held.byRow.get(heldKey('character_relationships', 'rel_1'))
    expect(captured).toMatchObject({ place: 'captured', row: rel })
    expect(captured?.holder.id).toBe('d_del')
    expect(held.byRow.get(heldKey('translations', 'tr_rel'))?.row).toEqual(trRel)
  })

  it('finds held rows naming a row through a link column and a translation discriminator', async () => {
    await insert(entityDelete)

    const held = await loadHeldRows(ctx, 'b1')

    expect(naming(held, 'entities', 'char_x')).toEqual(['captured character_relationships:rel_1'])
    expect(naming(held, 'entities', 'char_k')).toEqual([
      'captured character_relationships:rel_1',
      'captured translations:tr_own',
    ])
    expect(naming(held, 'character_relationships', 'rel_1')).toEqual([
      'captured translations:tr_rel',
    ])
    // The discriminator keeps an entity translation off another table's row of the same id.
    expect(naming(held, 'lore', 'char_k')).toEqual([])
  })

  it('finds a row deleted on its own that names a row', async () => {
    await insert(
      delta('d_rel', 4, {
        targetTable: 'character_relationships',
        targetId: 'rel_2',
        undoPayload: { ...rel, id: 'rel_2', aId: 'char_p', bId: 'char_x' },
      }),
    )

    const held = await loadHeldRows(ctx, 'b1')

    expect(naming(held, 'entities', 'char_p')).toEqual(['target character_relationships:rel_2'])
  })

  it('reads a payload that predates a cascade table as holding none of its rows', async () => {
    const { translations: _translations, ...older } = entityPayload
    await insert({ ...entityDelete, undoPayload: older })

    const held = await loadHeldRows(ctx, 'b1')

    expect([...held.byRow.keys()].sort()).toEqual([
      'character_relationships:rel_1',
      'entities:char_k',
    ])
  })

  it('keeps the newer of two deletes holding one row, and logs the broken log', async () => {
    const error = vi.spyOn(logger, 'error')
    await insert(
      delta('d_newer', 5, {
        targetTable: 'entities',
        targetId: 'char_k',
        undoPayload: { ...kade, relationships: [rel] },
      }),
      delta('d_older', 2, {
        targetTable: 'character_relationships',
        targetId: 'rel_1',
        undoPayload: rel,
      }),
    )

    const held = await loadHeldRows(ctx, 'b1')

    expect(held.byRow.get(heldKey('character_relationships', 'rel_1'))?.holder.id).toBe('d_newer')
    expect(naming(held, 'entities', 'char_x')).toEqual(['captured character_relationships:rel_1'])
    expect(error).toHaveBeenCalledWith('action_layer.row_held_twice', {
      table: 'character_relationships',
      id: 'rel_1',
      holders: ['d_older', 'd_newer'],
    })
  })

  it('ignores another branch and deltas that are not deletes', async () => {
    await insert(
      delta('d_b2', 1, {
        branchId: 'b2',
        targetTable: 'entities',
        targetId: 'char_k',
        undoPayload: { ...entityPayload, branchId: 'b2' },
      }),
      delta('d_upd', 2, {
        op: 'update',
        targetTable: 'entities',
        targetId: 'char_x',
        undoPayload: { relationships: [rel] },
      }),
    )

    expect((await loadHeldRows(ctx, 'b1')).byRow.size).toBe(0)
  })
})

describe('EMPTY_HELD_ROWS', () => {
  it('holds nothing and names nothing', () => {
    expect(EMPTY_HELD_ROWS.byRow.size).toBe(0)
    expect(EMPTY_HELD_ROWS.naming('entities', 'char_k')).toEqual([])
  })
})
