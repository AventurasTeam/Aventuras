import { desc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  branches,
  deltas,
  emptyEntityState,
  entities,
  stories,
  type CharacterState,
  type Delta,
  type Entity,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entitiesStore } from '@/lib/stores'
import { entityDeleteActions, parentIdOf } from '@/lib/world'

import { applyDeltaAction, applyDeltaActionGroup } from './apply-delta-action'
import { __redoGroupForTest, applyRedo, prepareUndo } from './redo'
import { ReversalIntegrityError } from './replay-errors'
import { reverseAndPruneDeltaRows, reverseReplayDeltas } from './reverse-replay'
import { selectReversalSet, type ReversalSet } from './row-closure'
import type { DbCtx, PipelineAction } from '../types'

let ctx: DbCtx

const faction = (id: string, branchId = 'b1'): NewEntity => ({
  id,
  branchId,
  kind: 'faction',
  name: id,
  status: 'active',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
})

const character = (id: string, factionId: string | null): NewEntity => ({
  id,
  branchId: 'b1',
  kind: 'character',
  name: id,
  status: 'active',
  injectionMode: 'auto',
  state: { ...emptyEntityState('character'), faction_id: factionId },
  createdAt: 1,
  updatedAt: 1,
})

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

const join = (id: string, factionId: string | null): PipelineAction => ({
  kind: 'setCharacterFaction',
  source: 'periodic_classifier',
  payload: { branchId: 'b1', id, factionId, proseEntryId: null },
})

const remove = (id: string): PipelineAction => ({
  kind: 'deleteEntity',
  source: 'user_edit',
  payload: { branchId: 'b1', id },
})

const move = (id: string, parent: string | null): PipelineAction => ({
  kind: 'updateEntity',
  source: 'user_edit',
  payload: { branchId: 'b1', id, patch: { state: { parent_location_id: parent } } },
})

async function act(actionId: string, action: PipelineAction): Promise<void> {
  const result = await applyDeltaAction({ action, actionId, branchId: 'b1' }, ctx)
  expect(result.status).toBe('ok')
}

async function deltasOf(...actionIds: string[]): Promise<Delta[]> {
  const rows = (await ctx.db.select().from(deltas).orderBy(desc(deltas.logPosition))) as Delta[]
  return rows.filter((d) => actionIds.includes(d.actionId))
}

const labels = (rows: readonly Delta[]) => rows.map((d) => `${d.op} ${d.targetTable}:${d.targetId}`)

const clears = (set: ReversalSet) =>
  set.refClears.map((c) => `${c.row.table}:${c.row.id}.${c.ref.path} -> ${c.removedId}`)

async function reverse(set: ReversalSet): Promise<void> {
  await reverseAndPruneDeltaRows(set, ctx, { keepRedoExact: false })
}

async function entityRow(id: string): Promise<Entity | undefined> {
  const [row] = await ctx.db.select().from(entities).where(eq(entities.id, id))
  return row as Entity | undefined
}

async function factionOf(id: string): Promise<string | null | undefined> {
  return ((await entityRow(id))?.state as CharacterState | undefined)?.faction_id
}

async function heldFactionOf(actionId: string): Promise<unknown> {
  const [holder] = await deltasOf(actionId)
  return (holder.undoPayload?.state as Record<string, unknown> | undefined)?.faction_id
}

async function hydrateEntities(): Promise<void> {
  entitiesStore.hydrate(
    'b1',
    await ctx.db.select().from(entities).where(eq(entities.branchId, 'b1')),
  )
}

beforeEach(async () => {
  const t = await createTestDb()
  ctx = { db: t.db, runInTransaction: t.runInTransaction }
  await ctx.db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await ctx.db.insert(branches).values([
    { id: 'b1', storyId: 's1', name: 'main', createdAt: 1 },
    { id: 'b2', storyId: 's1', name: 'fork', createdAt: 1 },
  ])
  await ctx.db.insert(entities).values(character('char_x', null))
})

afterEach(() => {
  entitiesStore.__reset()
})

async function seedMemberOfUserFaction(): Promise<void> {
  await act('act_f', {
    kind: 'createEntity',
    source: 'user_edit',
    payload: { entry: faction('fact_f') },
  })
  await act('act_pass', join('char_x', 'fact_f'))
}

describe('a character names its faction', () => {
  it('clears a member whose faction the reversal removes, keeping its own facts', async () => {
    await seedMemberOfUserFaction()
    await hydrateEntities()

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf('act_f') })

    expect(labels(set.rows)).toEqual(['create entities:fact_f'])
    expect(clears(set)).toEqual(['entities:char_x.faction_id -> fact_f'])
    await reverse(set)
    expect(await entityRow('fact_f')).toBeUndefined()
    expect(await factionOf('char_x')).toBeNull()
    expect((entitiesStore.getById('char_x')?.state as CharacterState).faction_id).toBeNull()
    expect(labels(await deltasOf('act_pass'))).toEqual(['update entities:char_x'])
  })

  it("clears the faction in a held member's copy", async () => {
    await seedMemberOfUserFaction()
    await act('act_del', remove('char_x'))

    await reverse(await selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf('act_f') }))

    expect(await heldFactionOf('act_del')).toBeNull()
    expect(labels(await deltasOf('act_del', 'act_pass'))).toEqual([
      'delete entities:char_x',
      'update entities:char_x',
    ])
  })

  it('puts the faction back with its row on redo', async () => {
    await seedMemberOfUserFaction()
    const set = await selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf('act_f') })

    const undo = await prepareUndo(set, ctx)
    await undo.reverse()
    expect(await factionOf('char_x')).toBeNull()
    await applyRedo(undo.group, ctx)

    expect(await entityRow('fact_f')).toBeDefined()
    expect(await factionOf('char_x')).toBe('fact_f')
  })

  it('returns a member the set re-inserts to the faction it held before the set moved it', async () => {
    await ctx.db.insert(entities).values(faction('fact_y'))
    await ctx.db
      .update(entities)
      .set({ state: { ...emptyEntityState('character'), faction_id: 'fact_y' } })
      .where(eq(entities.id, 'char_x'))
    await act('act_pass', {
      kind: 'createEntity',
      source: 'periodic_classifier',
      payload: { entry: faction('fact_r') },
    })
    await act('act_pass', join('char_x', 'fact_r'))
    await act('act_del', remove('char_x'))

    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: await deltasOf('act_pass', 'act_del'),
    })
    expect(clears(set)).toEqual([])
    await reverse(set)

    expect(await entityRow('fact_r')).toBeUndefined()
    expect(await factionOf('char_x')).toBe('fact_y')
  })

  it("refuses a CTRL-Z whose redo would restore a held member's faction", async () => {
    await seedMemberOfUserFaction()
    await act('act_del', remove('char_x'))
    const set = await selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf('act_f') })

    const refused = await prepareUndo(set, ctx).catch((e: unknown) => e)

    expect(refused).toBeInstanceOf(ReversalIntegrityError)
    expect(refused).toMatchObject({ refusal: 'held-in-redo' })
    expect((refused as Error).message).toContain('entities:char_x held by')
  })
})

describe('a reversal or redo never restores a dead id', () => {
  it('leaves none when a swept membership would restore a faction the user deleted since', async () => {
    await ctx.db.insert(entities).values([faction('fact_a'), faction('fact_b')])
    await ctx.db
      .update(entities)
      .set({ state: { ...emptyEntityState('character'), faction_id: 'fact_a' } })
      .where(eq(entities.id, 'char_x'))
    await act('act_pass', join('char_x', 'fact_b'))
    const branchEntities = (await ctx.db.select().from(entities)) as Entity[]
    const { actions } = entityDeleteActions({
      branchId: 'b1',
      target: branchEntities.find((e) => e.id === 'fact_a')!,
      branchEntities,
      tail: null,
    })
    expect(
      await applyDeltaActionGroup(actions, { actionId: 'act_del', branchId: 'b1' }, ctx),
    ).toEqual({
      status: 'ok',
    })

    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: [],
      sweep: await deltasOf('act_pass'),
    })
    await reverse(set)

    expect(await factionOf('char_x')).toBeNull()
    expect(await entityRow('fact_a')).toBeUndefined()
  })

  it("writes null when reversing a move off a place that's gone since", async () => {
    await act('act_pass', {
      kind: 'createEntity',
      source: 'periodic_classifier',
      payload: { entry: place('loc_r', null) },
    })
    await ctx.db.insert(entities).values(place('loc_p', null))
    await act('act_u1', move('loc_p', 'loc_r'))
    await act('act_u2', move('loc_p', null))
    await reverseReplayDeltas('act_pass', ctx)
    expect(await entityRow('loc_r')).toBeUndefined()

    await reverseReplayDeltas('act_u2', ctx)

    expect(parentIdOf((await entityRow('loc_p'))!)).toBeNull()
  })

  it.each([
    ['names no row', [] as NewEntity[]],
    ['names a row only another branch holds', [faction('fact_gone', 'b2')]],
  ])('writes null re-inserting a deleted character whose faction %s', async (_label, rows) => {
    if (rows.length > 0) await ctx.db.insert(entities).values(rows)
    await ctx.db
      .update(entities)
      .set({ state: { ...emptyEntityState('character'), faction_id: 'fact_gone' } })
      .where(eq(entities.id, 'char_x'))
    await act('act_del', remove('char_x'))

    await reverseReplayDeltas('act_del', ctx)

    expect(await factionOf('char_x')).toBeNull()
  })

  it('writes null when the same redo deletes the faction a restored row names', async () => {
    await ctx.db.insert(entities).values(faction('fact_f'))
    const before = (await entityRow('char_x'))!
    const factionRow = (await entityRow('fact_f'))!
    const delta = (id: string, op: Delta['op'], targetId: string, logPosition: number): Delta => ({
      id,
      branchId: 'b1',
      actionId: 'act_redo',
      op,
      targetTable: 'entities',
      targetId,
      entryId: null,
      source: 'user_edit',
      undoPayload: op === 'delete' ? { ...factionRow } : { state: { faction_id: null } },
      logPosition,
      encodingVersion: 1,
      createdAt: logPosition,
    })
    const named = {
      ...before,
      state: { ...(before.state as CharacterState), faction_id: 'fact_f' },
    }

    await hydrateEntities()
    await applyRedo(
      __redoGroupForTest([
        { delta: delta('delta_named', 'update', 'char_x', 98), rowBeforeUndo: named },
        { delta: delta('delta_gone', 'delete', 'fact_f', 99), rowBeforeUndo: factionRow },
      ]),
      ctx,
    )

    expect(await entityRow('fact_f')).toBeUndefined()
    expect(await factionOf('char_x')).toBeNull()
    expect(entitiesStore.getById('char_x')).toEqual(await entityRow('char_x'))
  })

  it('writes null when a redo would restore a faction no row holds', async () => {
    const before = (await entityRow('char_x'))!
    const delta: Delta = {
      id: 'delta_redo',
      branchId: 'b1',
      actionId: 'act_redo',
      op: 'update',
      targetTable: 'entities',
      targetId: 'char_x',
      entryId: null,
      source: 'user_edit',
      undoPayload: { state: { faction_id: null } },
      logPosition: 99,
      encodingVersion: 1,
      createdAt: 99,
    }
    const rowBeforeUndo = {
      ...before,
      state: { ...(before.state as CharacterState), faction_id: 'fact_gone' },
    }

    await hydrateEntities()
    await applyRedo(__redoGroupForTest([{ delta, rowBeforeUndo }]), ctx)

    expect(await factionOf('char_x')).toBeNull()
    expect(entitiesStore.getById('char_x')).toEqual(await entityRow('char_x'))
  })

  it('writes null when a redo puts back a faction only a sweep had set', async () => {
    await seedMemberOfUserFaction()
    await act('act_p2', {
      kind: 'createEntity',
      source: 'periodic_classifier',
      payload: { entry: faction('fact_z') },
    })
    await act('act_p2', join('char_x', 'fact_z'))
    await hydrateEntities()
    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: await deltasOf('act_f'),
      sweep: await deltasOf('act_p2'),
    })
    expect(clears(set)).toEqual(['entities:char_x.faction_id -> fact_f'])

    const undo = await prepareUndo(set, ctx)
    await undo.reverse()
    await applyRedo(undo.group, ctx)

    expect(await entityRow('fact_f')).toBeDefined()
    expect(await entityRow('fact_z')).toBeUndefined()
    expect(await factionOf('char_x')).toBeNull()
    expect((entitiesStore.getById('char_x')?.state as CharacterState).faction_id).toBeNull()
  })
})
