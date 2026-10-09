import { desc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import type { PipelineAction } from '@/lib/actions'
import { applyDeltaActionGroup } from '@/lib/actions/delta/apply-delta-action'
import { prepareUndo } from '@/lib/actions/delta/redo'
import { selectReversalSet } from '@/lib/actions/delta/row-closure'
import { normalizeCollisionName } from '@/lib/classifier'
import {
  branches,
  deltas,
  emptyEntityState,
  entities,
  stories,
  type DbCtx,
  type Delta,
  type Entity,
  type EntityKind,
  type EntityState,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entitiesStore } from '@/lib/stores'

import { namesakeKey, nameTakenByOther, orphanedFlags, withFlagClears } from './collision-flags'
import { entityActions } from './entity-actions'
import { entityDeleteActions } from './entity-delete'
import { characterDraftFrom } from './entity-draft'

function entity(
  id: string,
  name: string,
  overrides: Partial<Entity> = {},
  kind: EntityKind = 'character',
  state: Partial<EntityState> = {},
): Entity {
  return {
    id,
    branchId: 'b1',
    kind,
    name,
    description: null,
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    nameCollisionFlag: 0,
    state: { ...emptyEntityState(kind), ...state } as EntityState,
    tags: [],
    keywords: [],
    priority: 0,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const flagged = (id: string, name: string, overrides: Partial<Entity> = {}) =>
  entity(id, name, { nameCollisionFlag: 1, ...overrides })

describe('nameTakenByOther', () => {
  const branch = [
    entity('char_a', 'Kael'),
    entity('char_b', 'Jorin', { status: 'retired' }),
    entity('loc_a', 'Harbor', {}, 'location'),
  ]
  const taken = (name: string, exclude: string[] = [], kind: EntityKind = 'character') =>
    nameTakenByOther({ kind, name, entities: branch, exclude: new Set(exclude) })

  it('finds a same-kind row under the namesake rule, retired rows included', () => {
    expect(taken('  kael ')).toBe(true)
    expect(taken('JORIN')).toBe(true)
    expect(taken('Kael Stormborn')).toBe(false)
  })

  it('skips the excluded rows, another kind and a blank name', () => {
    expect(taken('Kael', ['char_a'])).toBe(false)
    expect(taken('Harbor')).toBe(false)
    expect(taken('Harbor', [], 'location')).toBe(true)
    expect(taken('   ')).toBe(false)
  })
})

describe('namesakeKey', () => {
  it.each([' Kael ', 'KAEL', 'Kae\u0301l', 'Ka\u00e9l'])(
    'agrees with the classifier’s namesake rule for %j',
    (name) => {
      expect(namesakeKey({ kind: 'character', name })).toBe(
        `character:${normalizeCollisionName(name)}`,
      )
    },
  )

  it('keys by kind as well as name', () => {
    expect(namesakeKey({ kind: 'character', name: 'Kael' })).not.toBe(
      namesakeKey({ kind: 'location', name: 'Kael' }),
    )
  })
})

describe('orphanedFlags', () => {
  const kael = flagged('char_f', 'Kael')
  const twin = entity('char_p', 'kael ')

  it('returns a flagged row whose partner is deleted', () => {
    expect(orphanedFlags({ entities: [kael, twin], removed: new Set(['char_p']) })).toStrictEqual([
      'char_f',
    ])
  })

  it('returns a flagged row whose partner is renamed away', () => {
    expect(
      orphanedFlags({ entities: [kael, twin], renamed: new Map([['char_p', 'Brannoc']]) }),
    ).toStrictEqual(['char_f'])
  })

  it('returns a flagged row renamed to a name no one else has', () => {
    expect(
      orphanedFlags({ entities: [kael, twin], renamed: new Map([['char_f', 'Kael the guard']]) }),
    ).toStrictEqual(['char_f'])
  })

  it('returns nothing for a case-only rename of the partner', () => {
    expect(
      orphanedFlags({ entities: [kael, twin], renamed: new Map([['char_p', 'KAEL']]) }),
    ).toStrictEqual([])
  })

  it('returns nothing while a third namesake remains', () => {
    const third = entity('char_q', 'Kael')
    expect(
      orphanedFlags({ entities: [kael, twin, third], removed: new Set(['char_p']) }),
    ).toStrictEqual([])
  })

  it('never returns the removed row, only the partner it leaves alone', () => {
    const flaggedTwin = flagged('char_p', 'Kael')
    expect(
      orphanedFlags({ entities: [kael, flaggedTwin], removed: new Set(['char_f']) }),
    ).toStrictEqual(['char_p'])
  })

  it('leaves a row already orphaned before the write untouched', () => {
    const lone = flagged('char_l', 'Lone')
    const mira = entity('char_m', 'Mira')
    const miraTwin = entity('char_n', 'Mira')
    expect(
      orphanedFlags({ entities: [lone, mira, miraTwin], removed: new Set(['char_n']) }),
    ).toStrictEqual([])
  })

  it('counts staged and retired namesakes', () => {
    const staged = entity('char_s', 'Kael', { status: 'staged' })
    const retired = entity('char_r', 'Kael', { status: 'retired' })
    expect(orphanedFlags({ entities: [kael, staged], removed: new Set(['char_s']) })).toStrictEqual(
      ['char_f'],
    )
    expect(
      orphanedFlags({ entities: [kael, staged, retired], removed: new Set(['char_r']) }),
    ).toStrictEqual([])
  })

  it('does not count a same-name row of another kind', () => {
    const place = entity('loc_k', 'Kael', {}, 'location')
    expect(
      orphanedFlags({ entities: [kael, twin, place], removed: new Set(['char_p']) }),
    ).toStrictEqual(['char_f'])
  })

  it('returns a flagged row renamed out of a group that still pairs without it', () => {
    const f = flagged('char_f', 'Kael')
    const p = entity('char_p', 'Kael')
    const q = entity('char_q', 'Kael')
    expect(
      orphanedFlags({ entities: [f, p, q], renamed: new Map([['char_f', 'Kael the guard']]) }),
    ).toStrictEqual(['char_f'])
  })

  it('leaves a flagged row renamed onto another row’s name', () => {
    const f = flagged('char_f', 'Kael')
    const p = entity('char_p', 'Kael')
    const m = entity('char_m', 'Mira')
    expect(
      orphanedFlags({ entities: [f, p, m], renamed: new Map([['char_f', 'Mira']]) }),
    ).toStrictEqual([])
  })
})

describe('withFlagClears', () => {
  const rename: PipelineAction = {
    kind: 'updateEntity',
    source: 'user_edit',
    payload: { branchId: 'b1', id: 'char_f', patch: { name: 'Kael the guard' } },
  }

  it('folds the clear into the row’s user update and appends one for a row without', () => {
    expect(withFlagClears([rename], 'b1', ['char_f', 'char_p'])).toStrictEqual([
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: {
          branchId: 'b1',
          id: 'char_f',
          patch: { name: 'Kael the guard', nameCollisionFlag: 0 },
        },
      },
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'char_p', patch: { nameCollisionFlag: 0 } },
      },
    ])
  })

  it('writes one clear for a repeated id and leaves its input as it was', () => {
    const input = [rename]
    const out = withFlagClears(input, 'b1', ['char_f', 'char_f'])
    expect(out).toHaveLength(1)
    expect(input).toStrictEqual([
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'char_f', patch: { name: 'Kael the guard' } },
      },
    ])
  })

  it('appends one clear for a repeated id the actions do not update', () => {
    expect(withFlagClears([], 'b1', ['x', 'x'])).toStrictEqual([
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'x', patch: { nameCollisionFlag: 0 } },
      },
    ])
  })

  it('does not fold into a classifier update', () => {
    const classifier: PipelineAction = { ...rename, source: 'periodic_classifier' }
    expect(withFlagClears([classifier], 'b1', ['char_f'])).toStrictEqual([
      classifier,
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'char_f', patch: { nameCollisionFlag: 0 } },
      },
    ])
  })
})

describe('orphan clears through the entity arm', () => {
  async function setup(rows: Entity[]): Promise<DbCtx> {
    const test = await createTestDb()
    const ctx: DbCtx = { db: test.db, runInTransaction: test.runInTransaction }
    await ctx.db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    await ctx.db.insert(entities).values(rows)
    entitiesStore.hydrate('b1', rows)
    return ctx
  }

  async function deltaRows(ctx: DbCtx): Promise<Delta[]> {
    return (await ctx.db.select().from(deltas).orderBy(desc(deltas.logPosition))) as Delta[]
  }

  async function flagOf(ctx: DbCtx, id: string): Promise<number | undefined> {
    const [row] = await ctx.db.select().from(entities).where(eq(entities.id, id))
    return row?.nameCollisionFlag
  }

  it('a save renaming the flagged row away commits its name and clear as one delta', async () => {
    const kael = flagged('char_f', 'Kael')
    const twin = entity('char_p', 'Kael')
    const ctx = await setup([kael, twin])
    const actions = entityActions({
      kind: 'character',
      draft: { ...characterDraftFrom(kael, []), name: 'Kael the guard' },
      relationships: [],
      relationshipsBase: [],
      keywordsBase: [],
      branchId: 'b1',
      row: kael,
      branchEntities: [kael, twin],
      id: 'char_f',
      now: 2,
    })

    expect(
      await applyDeltaActionGroup(actions, { actionId: 'act_1', branchId: 'b1' }, ctx),
    ).toStrictEqual({ status: 'ok' })
    expect(await flagOf(ctx, 'char_f')).toBe(0)
    const rows = await deltaRows(ctx)
    expect(rows).toHaveLength(1)
    expect(rows[0].undoPayload).toStrictEqual({ name: 'Kael', nameCollisionFlag: 1 })
  })

  it('a delete folds the clear into the partner’s ref patch, and undo re-flags it', async () => {
    const place = entity('loc_a', 'Hollow', {}, 'location')
    const child = entity('loc_b', 'Hollow', { nameCollisionFlag: 1 }, 'location', {
      parent_location_id: 'loc_a',
    })
    const ctx = await setup([place, child])
    const { actions } = entityDeleteActions({
      branchId: 'b1',
      target: place,
      branchEntities: [place, child],
      tail: null,
    })

    expect(
      await applyDeltaActionGroup(actions, { actionId: 'act_1', branchId: 'b1' }, ctx),
    ).toStrictEqual({ status: 'ok' })
    expect(await flagOf(ctx, 'loc_b')).toBe(0)
    const childDeltas = (await deltaRows(ctx)).filter((d) => d.targetId === 'loc_b')
    expect(childDeltas).toHaveLength(1)
    expect(Object.keys(childDeltas[0].undoPayload ?? {}).sort()).toStrictEqual([
      'nameCollisionFlag',
      'state',
    ])

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: await deltaRows(ctx) })
    await (await prepareUndo(set, ctx)).reverse()
    expect(await flagOf(ctx, 'loc_b')).toBe(1)
    expect(await flagOf(ctx, 'loc_a')).toBe(0)
  })

  it('a delete clears an unreferencing partner, and undo re-flags it and restores the target', async () => {
    const target = entity('char_x', 'Kael')
    const partner = flagged('char_p', 'Kael')
    const ctx = await setup([target, partner])
    const { actions } = entityDeleteActions({
      branchId: 'b1',
      target,
      branchEntities: [target, partner],
      tail: null,
    })

    expect(
      await applyDeltaActionGroup(actions, { actionId: 'act_1', branchId: 'b1' }, ctx),
    ).toStrictEqual({ status: 'ok' })
    expect(await flagOf(ctx, 'char_p')).toBe(0)
    expect(await flagOf(ctx, 'char_x')).toBeUndefined()

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: await deltaRows(ctx) })
    await (await prepareUndo(set, ctx)).reverse()
    expect(await flagOf(ctx, 'char_p')).toBe(1)
    expect(await flagOf(ctx, 'char_x')).toBe(0)
  })
})
