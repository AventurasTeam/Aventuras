import { desc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import type { PipelineAction } from '@/lib/actions'
import { applyDeltaActionGroup } from '@/lib/actions/delta/apply-delta-action'
import { prepareUndo } from '@/lib/actions/delta/redo'
import { selectReversalSet } from '@/lib/actions/delta/row-closure'
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
import { normalizeTerm } from '@/lib/keyword-terms'
import { entitiesStore } from '@/lib/stores'

import {
  brokenFlags,
  FLAG_CLEAR,
  flagsNaming,
  namesakeKey,
  nameTakenByOther,
  orphanedFlags,
  pairFlagsToClear,
  withFlagClears,
  withFlagWrites,
} from './collision-flags'
import { collisionPairOf } from './collision-pair'
import { entityActions } from './entity-actions'
import { entityDeleteActions } from './entity-delete'
import { characterDraftFrom } from './entity-draft'
import type { NamesakeSide } from './namesakes'

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
    nameCollisionPartnerId: null,
    nameCollisionReason: null,
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

const flagged = (id: string, name: string, partnerId: string, overrides: Partial<Entity> = {}) =>
  entity(id, name, {
    nameCollisionFlag: 1,
    nameCollisionPartnerId: partnerId,
    nameCollisionReason: 'distinct',
    ...overrides,
  })

describe('nameTakenByOther', () => {
  const branch = [
    entity('char_a', 'Kael Stormborn'),
    entity('char_b', 'Jorin', { status: 'retired' }),
    entity('loc_a', 'Harbor', {}, 'location'),
  ]
  const taken = (name: string, exclude: string[] = [], kind: EntityKind = 'character') =>
    nameTakenByOther({ kind, name, entities: branch, exclude: new Set(exclude) })

  it('finds a same-kind row with the same name, retired rows included', () => {
    expect(taken('  kael stormborn ')).toBe(true)
    expect(taken('Kael  Stormborn')).toBe(true)
    expect(taken('JORIN')).toBe(true)
  })

  it('does not count one name inside the other', () => {
    expect(taken('Kael')).toBe(false)
    expect(taken('Jorin the Elder')).toBe(false)
  })

  it('skips the excluded rows, another kind and a blank name', () => {
    expect(taken('Jorin', ['char_b'])).toBe(false)
    expect(taken('Harbor')).toBe(false)
    expect(taken('Harbor', [], 'location')).toBe(true)
    expect(taken('   ')).toBe(false)
  })
})

describe('namesakeKey', () => {
  it.each([' Kael ', 'KAEL', 'Kae\u0301l', 'Ka\u00e9l'])(
    'keys by the keyword-term normalization for %j',
    (name) => {
      expect(namesakeKey({ kind: 'character', name })).toBe(`character:${normalizeTerm(name)}`)
    },
  )

  it('keys by kind as well as name', () => {
    expect(namesakeKey({ kind: 'character', name: 'Kael' })).not.toBe(
      namesakeKey({ kind: 'location', name: 'Kael' }),
    )
  })
})

describe('orphanedFlags', () => {
  const kael = flagged('char_f', 'Kael', 'char_p')
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
    const flaggedTwin = flagged('char_p', 'Kael', 'char_f')
    expect(
      orphanedFlags({ entities: [kael, flaggedTwin], removed: new Set(['char_f']) }),
    ).toStrictEqual(['char_p'])
  })

  it('leaves a row already orphaned before the write untouched', () => {
    const lone = flagged('char_l', 'Lone', 'char_gone')
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
    const f = flagged('char_f', 'Kael', 'char_p')
    const p = entity('char_p', 'Kael')
    const q = entity('char_q', 'Kael')
    expect(
      orphanedFlags({ entities: [f, p, q], renamed: new Map([['char_f', 'Kael the guard']]) }),
    ).toStrictEqual(['char_f'])
  })

  it('leaves a flagged row renamed onto another row’s name', () => {
    const f = flagged('char_f', 'Kael', 'char_p')
    const p = entity('char_p', 'Kael')
    const m = entity('char_m', 'Mira')
    expect(
      orphanedFlags({ entities: [f, p, m], renamed: new Map([['char_f', 'Mira']]) }),
    ).toStrictEqual([])
  })
})

describe('FLAG_CLEAR', () => {
  it('clears the flag with its partner and reason', () => {
    expect(FLAG_CLEAR).toStrictEqual({
      nameCollisionFlag: 0,
      nameCollisionPartnerId: null,
      nameCollisionReason: null,
    })
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
          patch: {
            name: 'Kael the guard',
            nameCollisionFlag: 0,
            nameCollisionPartnerId: null,
            nameCollisionReason: null,
          },
        },
      },
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: {
          branchId: 'b1',
          id: 'char_p',
          patch: { nameCollisionFlag: 0, nameCollisionPartnerId: null, nameCollisionReason: null },
        },
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
        payload: {
          branchId: 'b1',
          id: 'x',
          patch: { nameCollisionFlag: 0, nameCollisionPartnerId: null, nameCollisionReason: null },
        },
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
        payload: {
          branchId: 'b1',
          id: 'char_f',
          patch: { nameCollisionFlag: 0, nameCollisionPartnerId: null, nameCollisionReason: null },
        },
      },
    ])
  })
})

describe('flagsNaming', () => {
  it('returns each row outside the removed set whose flag names a removed row', () => {
    const rows = [
      entity('char_p', 'Kael'),
      flagged('char_f', 'Kael', 'char_p'),
      flagged('char_g', 'Kael Stormborn', 'char_p'),
      flagged('char_h', 'Kael', 'char_q'),
      entity('char_q', 'Kael'),
    ]
    expect(flagsNaming(rows, new Set(['char_p']))).toStrictEqual(['char_f', 'char_g'])
  })

  it('never returns a removed row, even one whose flag names another removed row', () => {
    const rows = [flagged('char_f', 'Kael', 'char_p'), entity('char_p', 'Kael')]
    expect(flagsNaming(rows, new Set(['char_f', 'char_p']))).toStrictEqual([])
  })
})

describe('brokenFlags', () => {
  const partner = entity('char_p', 'Kael Stormborn')
  const kael = flagged('char_f', 'Kael', 'char_p')
  const broken = (rows: Entity[], after: [string, NamesakeSide][]) =>
    brokenFlags({ entities: rows, after: new Map(after) })

  it('returns a flagged row renamed out of its partner’s namesakes', () => {
    expect(broken([partner, kael], [['char_f', { name: 'Brannoc', keywords: [] }]])).toStrictEqual([
      'char_f',
    ])
  })

  it('returns a flagged row whose partner is renamed away', () => {
    expect(broken([partner, kael], [['char_p', { name: 'Brannoc', keywords: [] }]])).toStrictEqual([
      'char_f',
    ])
  })

  it('keeps a flag whose pair still matches by name, case aside, or through a keyword', () => {
    expect(broken([partner, kael], [['char_f', { name: 'KAEL', keywords: [] }]])).toStrictEqual([])
    expect(
      broken([partner, kael], [['char_p', { name: 'Kael Stormborn the Elder', keywords: [] }]]),
    ).toStrictEqual([])
    expect(
      broken([partner, kael], [['char_f', { name: 'Brannoc', keywords: ['Kael Stormborn'] }]]),
    ).toStrictEqual([])
  })

  it('reads a row outside `after` with its stored name and keywords', () => {
    const known = { ...partner, keywords: ['Brannoc'] }
    expect(broken([known, kael], [['char_f', { name: 'Brannoc', keywords: [] }]])).toStrictEqual([])
  })

  it('judges only flags with a side in `after`', () => {
    const stale = flagged('char_o', 'Mira', 'char_p')
    expect(
      broken([partner, kael, stale], [['char_f', { name: 'KAEL', keywords: [] }]]),
    ).toStrictEqual([])
  })

  it('leaves a dormant flag, whose partner the branch no longer has', () => {
    const dormant = flagged('char_d', 'Kael', 'char_gone')
    expect(broken([dormant], [['char_d', { name: 'Brannoc', keywords: [] }]])).toStrictEqual([])
  })
})

describe('pairFlagsToClear', () => {
  const pairOf = (rows: Entity[], ids: readonly [string, string]) => {
    const lookup = collisionPairOf(rows, ids)
    if ('miss' in lookup) throw new Error(`not a collision pair: ${lookup.miss}`)
    return lookup.pair
  }
  const older = entity('char_a', 'Kael')
  const newer = flagged('char_b', 'Kael', 'char_a')

  it('returns the flagged row whose partner is the other row, and no unflagged row', () => {
    const rows = [older, newer]
    expect(pairFlagsToClear(pairOf(rows, ['char_a', 'char_b']), rows)).toStrictEqual(['char_b'])
  })

  it('returns a pair row whose partner is gone from the branch', () => {
    const dormant = flagged('char_a', 'Kael', 'char_gone')
    const rows = [dormant, newer]
    expect(pairFlagsToClear(pairOf(rows, ['char_a', 'char_b']), rows)).toStrictEqual([
      'char_a',
      'char_b',
    ])
  })

  it('keeps a pair row’s flag that names a live third row', () => {
    const third = entity('char_c', 'Kael')
    const naming = flagged('char_a', 'Kael', 'char_c')
    const rows = [naming, newer, third]
    expect(pairFlagsToClear(pairOf(rows, ['char_a', 'char_b']), rows)).toStrictEqual(['char_b'])
  })
})

describe('withFlagWrites', () => {
  const stateUpdate: PipelineAction = {
    kind: 'updateEntity',
    source: 'user_edit',
    payload: { branchId: 'b1', id: 'char_f', patch: { state: emptyEntityState('character') } },
  }
  const clearOf = (id: string): PipelineAction => ({
    kind: 'updateEntity',
    source: 'user_edit',
    payload: { branchId: 'b1', id, patch: FLAG_CLEAR },
  })

  it('folds a re-point into the row’s user update and appends one for a row without', () => {
    expect(
      withFlagWrites([stateUpdate], 'b1', [
        { id: 'char_f', partnerId: 'char_a' },
        { id: 'char_g', partnerId: 'char_a' },
      ]),
    ).toStrictEqual([
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: {
          branchId: 'b1',
          id: 'char_f',
          patch: { state: emptyEntityState('character'), nameCollisionPartnerId: 'char_a' },
        },
      },
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'char_g', patch: { nameCollisionPartnerId: 'char_a' } },
      },
    ])
  })

  it('resolves a clear and a re-point for one row to the clear, in either order', () => {
    expect(
      withFlagWrites([], 'b1', [
        { id: 'char_f', partnerId: 'char_a' },
        { id: 'char_f', clear: true },
      ]),
    ).toStrictEqual([clearOf('char_f')])
    expect(
      withFlagWrites([], 'b1', [
        { id: 'char_f', clear: true },
        { id: 'char_f', partnerId: 'char_a' },
      ]),
    ).toStrictEqual([clearOf('char_f')])
  })

  it('keeps a clear an earlier step already folded into the row', () => {
    const cleared = withFlagClears([stateUpdate], 'b1', ['char_f'])
    expect(withFlagWrites(cleared, 'b1', [{ id: 'char_f', partnerId: 'char_a' }])).toStrictEqual(
      cleared,
    )
  })
})

describe('flag clears through the entity arm', () => {
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

  async function flagOf(ctx: DbCtx, id: string) {
    const [row] = await ctx.db.select().from(entities).where(eq(entities.id, id))
    return row == null
      ? undefined
      : [row.nameCollisionFlag, row.nameCollisionPartnerId, row.nameCollisionReason]
  }

  const flagColumns = (row: Entity) => [
    row.nameCollisionFlag,
    row.nameCollisionPartnerId,
    row.nameCollisionReason,
  ]

  async function undoEverything(ctx: DbCtx): Promise<void> {
    const set = await selectReversalSet(ctx, { branchId: 'b1', target: await deltaRows(ctx) })
    await (await prepareUndo(set, ctx)).reverse()
  }

  function renameTo(row: Entity, name: string, branchEntities: Entity[]): PipelineAction[] {
    return entityActions({
      kind: 'character',
      draft: { ...characterDraftFrom(row, []), name },
      relationships: [],
      relationshipsBase: [],
      keywordsBase: row.keywords,
      branchId: 'b1',
      row,
      branchEntities,
      id: row.id,
      now: 2,
    })
  }

  it('a save renaming the flagged row away commits its name and clear as one delta', async () => {
    const kael = flagged('char_f', 'Kael', 'char_p')
    const twin = entity('char_p', 'Kael')
    const ctx = await setup([kael, twin])

    const actions = renameTo(kael, 'Brannoc', [kael, twin])
    expect(
      await applyDeltaActionGroup(actions, { actionId: 'act_1', branchId: 'b1' }, ctx),
    ).toStrictEqual({ status: 'ok' })
    expect(await flagOf(ctx, 'char_f')).toStrictEqual([0, null, null])
    const rows = await deltaRows(ctx)
    expect(rows).toHaveLength(1)
    expect(rows[0].undoPayload).toStrictEqual({
      name: 'Kael',
      nameCollisionFlag: 1,
      nameCollisionPartnerId: 'char_p',
      nameCollisionReason: kael.nameCollisionReason,
    })

    await undoEverything(ctx)
    expect(await flagOf(ctx, 'char_f')).toStrictEqual(flagColumns(kael))
  })

  it('a save that keeps the partner’s name inside the new one writes only the name', async () => {
    const kael = flagged('char_f', 'Kael', 'char_p')
    const twin = entity('char_p', 'Kael')
    const ctx = await setup([kael, twin])

    const actions = renameTo(kael, 'Kael Stormborn', [kael, twin])
    expect(
      await applyDeltaActionGroup(actions, { actionId: 'act_1', branchId: 'b1' }, ctx),
    ).toStrictEqual({ status: 'ok' })
    expect(await flagOf(ctx, 'char_f')).toStrictEqual(flagColumns(kael))
    expect((await deltaRows(ctx))[0].undoPayload).toStrictEqual({ name: 'Kael' })
  })

  it('a delete folds the clear into the partner’s ref patch, and undo re-flags it', async () => {
    const place = entity('loc_a', 'Hollow', {}, 'location')
    const child = entity(
      'loc_b',
      'Hollow',
      { nameCollisionFlag: 1, nameCollisionPartnerId: 'loc_a', nameCollisionReason: 'distinct' },
      'location',
      { parent_location_id: 'loc_a' },
    )
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
    expect(await flagOf(ctx, 'loc_b')).toStrictEqual([0, null, null])
    const childDeltas = (await deltaRows(ctx)).filter((d) => d.targetId === 'loc_b')
    expect(childDeltas).toHaveLength(1)
    expect(Object.keys(childDeltas[0].undoPayload ?? {}).sort()).toStrictEqual([
      'nameCollisionFlag',
      'nameCollisionPartnerId',
      'nameCollisionReason',
      'state',
    ])

    await undoEverything(ctx)
    expect(await flagOf(ctx, 'loc_b')).toStrictEqual([1, 'loc_a', 'distinct'])
    expect(await flagOf(ctx, 'loc_a')).toStrictEqual([0, null, null])
  })

  it('a delete clears the flag naming it while a same-name third row remains, and undo re-flags it', async () => {
    const target = entity('char_x', 'Kael')
    const partner = flagged('char_p', 'Kael', 'char_x')
    const third = entity('char_q', 'Kael')
    const ctx = await setup([target, partner, third])
    const { actions } = entityDeleteActions({
      branchId: 'b1',
      target,
      branchEntities: [target, partner, third],
      tail: null,
    })

    expect(
      await applyDeltaActionGroup(actions, { actionId: 'act_1', branchId: 'b1' }, ctx),
    ).toStrictEqual({ status: 'ok' })
    expect(await flagOf(ctx, 'char_p')).toStrictEqual([0, null, null])
    expect(await flagOf(ctx, 'char_x')).toBeUndefined()

    await undoEverything(ctx)
    expect(await flagOf(ctx, 'char_p')).toStrictEqual(flagColumns(partner))
    expect(await flagOf(ctx, 'char_x')).toStrictEqual([0, null, null])
  })
})
