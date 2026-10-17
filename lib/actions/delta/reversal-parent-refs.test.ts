import { desc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { branches, deltas, entities, stories, type Delta, type NewEntity } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entitiesStore } from '@/lib/stores'
import { parentIdOf } from '@/lib/world'

import { applyDeltaAction } from './apply-delta-action'
import { withKeyLock } from './key-lock'
import { applyRedo, prepareUndo } from './redo'
import { ReversalIntegrityError } from './replay-errors'
import { reverseAndPruneDeltaRows } from './reverse-replay'
import { reversalLockKeys, selectReversalSet, type ReversalSet } from './row-closure'
import type { DbCtx, DeltaSource, PipelineAction } from '../types'

let ctx: DbCtx

const place = (id: string, parent: string | null, branchId = 'b1'): NewEntity => ({
  id,
  branchId,
  kind: 'location',
  name: id,
  status: 'active',
  injectionMode: 'auto',
  state: { parent_location_id: parent },
  createdAt: 1,
  updatedAt: 1,
})

const create = (id: string, parent: string | null, source: DeltaSource): PipelineAction => ({
  kind: 'createEntity',
  source,
  payload: { entry: place(id, parent) },
})

const move = (id: string, parent: string | null): PipelineAction => ({
  kind: 'updateEntity',
  source: 'user_edit',
  payload: { branchId: 'b1', id, patch: { state: { parent_location_id: parent } } },
})

const rename = (id: string, name: string): PipelineAction => ({
  kind: 'updateEntity',
  source: 'user_edit',
  payload: { branchId: 'b1', id, patch: { name } },
})

const flood = (id: string, parent: string): PipelineAction => ({
  kind: 'updateEntity',
  source: 'user_edit',
  payload: {
    branchId: 'b1',
    id,
    patch: { state: { parent_location_id: parent, condition: 'flooded' } },
  },
})

const remove = (id: string): PipelineAction => ({
  kind: 'deleteEntity',
  source: 'user_edit',
  payload: { branchId: 'b1', id },
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

async function entityIds(): Promise<string[]> {
  const rows = await ctx.db
    .select({ id: entities.id })
    .from(entities)
    .where(eq(entities.branchId, 'b1'))
  return rows.map((row) => row.id).sort()
}

async function entityRow(id: string) {
  const [row] = await ctx.db.select().from(entities).where(eq(entities.id, id))
  return row
}

async function parentOf(id: string): Promise<string | null> {
  return parentIdOf(await entityRow(id))
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
  await ctx.db.insert(entities).values(place('loc_quarter', null))
})

afterEach(() => {
  entitiesStore.__reset()
})

describe('selectReversalSet — a place names its parent', () => {
  async function seedDocksUnderVarn(): Promise<void> {
    await act('act_varn', create('loc_varn', null, 'user_edit'))
    await act('act_pass', create('loc_docks', 'loc_varn', 'periodic_classifier'))
    await act('act_pass', create('loc_pier', 'loc_docks', 'periodic_classifier'))
    await act('act_rename', rename('loc_docks', 'The Docks'))
    // Another branch's row naming the parent's id isn't this branch's referrer.
    await ctx.db.insert(entities).values(place('loc_fork', 'loc_varn', 'b2'))
  }

  it('leaves a child reached through its parent, and its writes, out of the set', async () => {
    await seedDocksUnderVarn()

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf('act_varn') })

    expect(labels(set.rows)).toEqual(['create entities:loc_varn'])
    expect(clears(set)).toEqual(['entities:loc_docks.parent_location_id -> loc_varn'])
  })

  it("clears a kept child's parent, keeping its own child under it and its other writes", async () => {
    await seedDocksUnderVarn()
    await hydrateEntities()

    await reverse(
      await selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf('act_varn') }),
    )

    expect(await entityIds()).toEqual(['loc_docks', 'loc_pier', 'loc_quarter'])
    expect(await parentOf('loc_docks')).toBeNull()
    expect((await entityRow('loc_docks')).name).toBe('The Docks')
    expect(entitiesStore.getById('loc_docks')?.state).toEqual({ parent_location_id: null })
    expect(entitiesStore.getById('loc_varn')).toBeUndefined()
    expect(await parentOf('loc_pier')).toBe('loc_docks')
    expect(await parentOf('loc_fork')).toBe('loc_varn')
    expect(labels(await deltasOf('act_pass', 'act_rename'))).toEqual([
      'update entities:loc_docks',
      'create entities:loc_pier',
      'create entities:loc_docks',
    ])
  })

  it('keeps an older place the set moved under a removed parent, back under its old one', async () => {
    await act('act_old', create('loc_old', 'loc_quarter', 'piggyback_tagged_block'))
    await act('act_varn', create('loc_varn', null, 'user_edit'))
    await act('act_move', move('loc_old', 'loc_varn'))

    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: await deltasOf('act_varn', 'act_move'),
    })

    expect(labels(set.rows)).toEqual(['update entities:loc_old', 'create entities:loc_varn'])
    expect(clears(set)).toEqual([])
    await reverse(set)
    expect(await entityIds()).toEqual(['loc_old', 'loc_quarter'])
    expect(await parentOf('loc_old')).toBe('loc_quarter')
  })

  it('keeps a root place the set moved under a removed parent, back at the root', async () => {
    await act('act_root', create('loc_root', null, 'piggyback_tagged_block'))
    await act('act_varn', create('loc_varn', null, 'user_edit'))
    await act('act_move', move('loc_root', 'loc_varn'))

    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: await deltasOf('act_varn', 'act_move'),
    })

    expect(labels(set.rows)).toEqual(['update entities:loc_root', 'create entities:loc_varn'])
    expect(clears(set)).toEqual([])
    await reverse(set)
    expect(await entityIds()).toEqual(['loc_quarter', 'loc_root'])
    expect(await parentOf('loc_root')).toBeNull()
  })

  it('clears a child whose state the set changed without moving it', async () => {
    await act('act_varn', create('loc_varn', null, 'user_edit'))
    await act('act_pass', create('loc_docks', 'loc_varn', 'periodic_classifier'))
    await act('act_flood', flood('loc_docks', 'loc_varn'))

    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: await deltasOf('act_varn', 'act_flood'),
    })

    expect(labels(set.rows)).toEqual(['update entities:loc_docks', 'create entities:loc_varn'])
    expect(clears(set)).toEqual(['entities:loc_docks.parent_location_id -> loc_varn'])
    await reverse(set)
    expect((await entityRow('loc_docks')).state).toEqual({ parent_location_id: null })
  })

  it('judges a place the set moved twice by what its oldest move replaced', async () => {
    await act('act_old', create('loc_old', 'loc_quarter', 'piggyback_tagged_block'))
    await act('act_harbor', create('loc_harbor', null, 'user_edit'))
    await act('act_varn', create('loc_varn', null, 'user_edit'))
    await act('act_move', move('loc_old', 'loc_varn'))
    await act('act_move_again', move('loc_old', 'loc_harbor'))

    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: await deltasOf('act_varn', 'act_move', 'act_move_again'),
    })

    expect(labels(set.rows)).toEqual([
      'update entities:loc_old',
      'update entities:loc_old',
      'create entities:loc_varn',
    ])
    expect(clears(set)).toEqual([])
    await reverse(set)
    expect(await parentOf('loc_old')).toBe('loc_quarter')
  })

  it('keeps a held place the set moved under a removed parent; its copy returns to the old one', async () => {
    await act('act_old', create('loc_old', 'loc_quarter', 'piggyback_tagged_block'))
    await act('act_varn', create('loc_varn', null, 'user_edit'))
    await act('act_move', move('loc_old', 'loc_varn'))
    await act('act_del', remove('loc_old'))

    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: await deltasOf('act_varn', 'act_move'),
    })

    expect(labels(set.rows)).toEqual(['update entities:loc_old', 'create entities:loc_varn'])
    expect(clears(set)).toEqual([])
    await reverse(set)
    const [holder] = await deltasOf('act_del')
    expect(holder.undoPayload?.state).toEqual({ parent_location_id: 'loc_quarter' })
  })

  it('leaves a place the set moved off a removed parent at the root', async () => {
    await act('act_varn', create('loc_varn', null, 'user_edit'))
    await act('act_pass', create('loc_docks', 'loc_varn', 'periodic_classifier'))
    await act('act_move', move('loc_docks', 'loc_quarter'))

    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: await deltasOf('act_varn', 'act_move'),
    })

    expect(labels(set.rows)).toEqual(['update entities:loc_docks', 'create entities:loc_varn'])
    expect(clears(set)).toEqual(['entities:loc_docks.parent_location_id -> loc_varn'])
    await reverse(set)
    expect(await entityIds()).toEqual(['loc_docks', 'loc_quarter'])
    expect(await parentOf('loc_docks')).toBeNull()
  })

  it("clears a held child's copy in its holder's payload", async () => {
    await act('act_varn', create('loc_varn', null, 'user_edit'))
    await act('act_pass', create('loc_docks', 'loc_varn', 'periodic_classifier'))
    await act('act_del', remove('loc_docks'))

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf('act_varn') })

    expect(labels(set.rows)).toEqual(['create entities:loc_varn'])
    expect(clears(set)).toEqual(['entities:loc_docks.parent_location_id -> loc_varn'])
    await reverse(set)
    expect(await entityIds()).toEqual(['loc_quarter'])
    expect(labels(await deltasOf('act_pass', 'act_del'))).toEqual([
      'delete entities:loc_docks',
      'create entities:loc_docks',
    ])
    const [holder] = await deltasOf('act_del')
    expect(holder.undoPayload?.state).toEqual({ parent_location_id: null })
  })

  it('clears a held child on its row once the set undoes its delete', async () => {
    await act('act_varn', create('loc_varn', null, 'user_edit'))
    await act('act_pass', create('loc_docks', 'loc_varn', 'periodic_classifier'))
    await act('act_del', remove('loc_docks'))

    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: await deltasOf('act_varn', 'act_del'),
    })

    expect(labels(set.rows)).toEqual(['delete entities:loc_docks', 'create entities:loc_varn'])
    expect(clears(set)).toEqual(['entities:loc_docks.parent_location_id -> loc_varn'])
    await reverse(set)
    expect(await entityIds()).toEqual(['loc_docks', 'loc_quarter'])
    expect(await parentOf('loc_docks')).toBeNull()
  })

  it.each([
    ['the user made', true],
    ['the wizard or a seed made', false],
  ] as const)(
    'clears a place %s that a write outside the set moved under a removed parent',
    async (_label, logged) => {
      if (logged) {
        await act('act_x', create('loc_x', null, 'user_edit'))
        await act('act_z', create('loc_z', 'loc_x', 'user_edit'))
      }
      const moved = logged ? 'loc_x' : 'loc_quarter'
      await act('act_pass', create('loc_p', null, 'periodic_classifier'))
      await act('act_move', move(moved, 'loc_p'))

      const set = await selectReversalSet(ctx, {
        branchId: 'b1',
        target: await deltasOf('act_pass'),
      })

      expect(labels(set.rows)).toEqual(['create entities:loc_p'])
      expect(clears(set)).toEqual([`entities:${moved}.parent_location_id -> loc_p`])
      await reverse(set)
      expect(await parentOf(moved)).toBeNull()
      if (logged) expect(await parentOf('loc_z')).toBe('loc_x')
      expect(labels(await deltasOf('act_move'))).toEqual([`update entities:${moved}`])
    },
  )

  it('clears a child a write outside the set changed without moving it', async () => {
    await act('act_varn', create('loc_varn', null, 'user_edit'))
    await act('act_pass', create('loc_docks', 'loc_varn', 'periodic_classifier'))
    await act('act_flood', flood('loc_docks', 'loc_varn'))

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf('act_varn') })

    expect(labels(set.rows)).toEqual(['create entities:loc_varn'])
    await reverse(set)
    expect((await entityRow('loc_docks')).state).toEqual({
      parent_location_id: null,
      condition: 'flooded',
    })
  })

  it('clears no ref in a child whose own create the set holds', async () => {
    await act('act_pass', create('loc_varn', null, 'periodic_classifier'))
    await act('act_pass', create('loc_docks', 'loc_varn', 'periodic_classifier'))

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf('act_pass') })

    expect(labels(set.rows)).toEqual(['create entities:loc_docks', 'create entities:loc_varn'])
    expect(clears(set)).toEqual([])
  })

  it('locks a row it clears a ref in', async () => {
    await act('act_varn', create('loc_varn', null, 'user_edit'))
    await act('act_pass', create('loc_docks', 'loc_varn', 'periodic_classifier'))

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf('act_varn') })

    expect(reversalLockKeys(set)).toContain('entities:b1:loc_docks')
  })

  it("takes a removed place's own later move outside the set, as any later write", async () => {
    await act('act_varn', create('loc_varn', null, 'user_edit'))
    await act('act_move', move('loc_varn', 'loc_quarter'))

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf('act_varn') })

    expect(labels(set.rows)).toEqual(['update entities:loc_varn', 'create entities:loc_varn'])
    expect(clears(set)).toEqual([])
  })
})

describe('redo of a CTRL-Z that cleared a parent', () => {
  it('puts the child back under the parent it restores', async () => {
    await act('act_varn', create('loc_varn', null, 'user_edit'))
    await act('act_pass', create('loc_docks', 'loc_varn', 'periodic_classifier'))
    await hydrateEntities()
    const set = await selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf('act_varn') })
    const { group, reverse: undo } = await prepareUndo(set, ctx)

    await undo()
    expect(await entityIds()).toEqual(['loc_docks', 'loc_quarter'])
    expect(await parentOf('loc_docks')).toBeNull()
    expect(entitiesStore.getById('loc_docks')?.state).toEqual({ parent_location_id: null })

    await applyRedo(group, ctx)
    expect(await entityIds()).toEqual(['loc_docks', 'loc_quarter', 'loc_varn'])
    expect(await parentOf('loc_docks')).toBe('loc_varn')
    expect(entitiesStore.getById('loc_docks')?.state).toEqual({ parent_location_id: 'loc_varn' })
    expect(entitiesStore.getById('loc_varn')).toBeDefined()
    expect(labels(await deltasOf('act_varn', 'act_pass'))).toEqual([
      'create entities:loc_docks',
      'create entities:loc_varn',
    ])
    expect(await ctx.db.select().from(deltas)).toHaveLength(2)
  })

  it('waits on the lock of a row it puts a ref back in', async () => {
    await act('act_varn', create('loc_varn', null, 'user_edit'))
    await act('act_pass', create('loc_docks', 'loc_varn', 'periodic_classifier'))
    const set = await selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf('act_varn') })
    const { group, reverse: undo } = await prepareUndo(set, ctx)
    await undo()
    let release = () => {}
    const save = withKeyLock(
      'entities:b1:loc_docks',
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )

    const redo = applyRedo(group, ctx)
    const first = await Promise.race([
      redo.then(() => 'redo'),
      new Promise((resolve) => setTimeout(() => resolve('save'), 50)),
    ])
    const whileHeld = await ctx.db.select().from(entities).where(eq(entities.id, 'loc_docks'))
    // Released before any assertion: a held key would stall every later test on it.
    release()
    await Promise.all([save, redo])

    expect(first).toBe('save')
    expect(whileHeld.map((row) => row.state)).toEqual([{ parent_location_id: null }])
    expect(await parentOf('loc_docks')).toBe('loc_varn')
  })

  it('keeps a child cleared through a parent only a sweep removed', async () => {
    await act('act_varn', create('loc_varn', null, 'periodic_classifier'))
    await act('act_pass', create('loc_docks', 'loc_varn', 'periodic_classifier'))
    await act('act_rename', rename('loc_quarter', 'The Quarter'))
    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: await deltasOf('act_rename'),
      sweep: await deltasOf('act_varn'),
    })
    expect(clears(set)).toEqual(['entities:loc_docks.parent_location_id -> loc_varn'])
    const { group, reverse: undo } = await prepareUndo(set, ctx)

    await undo()
    await applyRedo(group, ctx)

    expect(await entityIds()).toEqual(['loc_docks', 'loc_quarter'])
    expect((await entityRow('loc_quarter')).name).toBe('The Quarter')
    expect(await parentOf('loc_docks')).toBeNull()
  })

  it('refuses a CTRL-Z whose redo would restore the parent of a held child it clears', async () => {
    await act('act_varn', create('loc_varn', null, 'user_edit'))
    await act('act_pass', create('loc_docks', 'loc_varn', 'periodic_classifier'))
    await act('act_del', remove('loc_docks'))
    const set = await selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf('act_varn') })

    const prepared = prepareUndo(set, ctx)

    await expect(prepared).rejects.toBeInstanceOf(ReversalIntegrityError)
    await expect(prepared).rejects.toMatchObject({ refusal: 'held-in-redo' })
    await expect(prepared).rejects.toThrow('entities:loc_docks held by')
  })
})
