import { desc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { branches, deltas, entities, stories, type Delta, type NewEntity } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { parentIdOf } from '@/lib/world'

import { applyDeltaAction } from './apply-delta-action'
import { applyRedo, prepareUndo } from './redo'
import { ReversalIntegrityError } from './replay-errors'
import { reverseAndPruneDeltaRows } from './reverse-replay'
import { selectReversalSet, type ReversalSet } from './row-closure'
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

const labels = (set: ReversalSet) => set.rows.map((d) => `${d.op} ${d.targetTable}:${d.targetId}`)

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

async function parentOf(id: string): Promise<string | null> {
  const [row] = await ctx.db.select().from(entities).where(eq(entities.id, id))
  return parentIdOf(row)
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

describe('selectReversalSet — a place names its parent', () => {
  it('takes a child reached through its parent, with every write to it and its own child', async () => {
    await act('act_varn', create('loc_varn', null, 'user_edit'))
    await act('act_pass', create('loc_docks', 'loc_varn', 'periodic_classifier'))
    await act('act_pass', create('loc_pier', 'loc_docks', 'periodic_classifier'))
    await act('act_rename', {
      kind: 'updateEntity',
      source: 'user_edit',
      payload: { branchId: 'b1', id: 'loc_docks', patch: { name: 'The Docks' } },
    })
    // Another branch's row naming the parent's id isn't this branch's referrer.
    await ctx.db.insert(entities).values(place('loc_fork', 'loc_varn', 'b2'))

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf('act_varn') })

    expect(labels(set)).toEqual([
      'update entities:loc_docks',
      'create entities:loc_pier',
      'create entities:loc_docks',
      'create entities:loc_varn',
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

    expect(labels(set)).toEqual(['update entities:loc_old', 'create entities:loc_varn'])
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

    expect(labels(set)).toEqual(['update entities:loc_root', 'create entities:loc_varn'])
    await reverse(set)
    expect(await entityIds()).toEqual(['loc_quarter', 'loc_root'])
    expect(await parentOf('loc_root')).toBeNull()
  })

  it('takes a child whose state the set changed without moving it', async () => {
    await act('act_varn', create('loc_varn', null, 'user_edit'))
    await act('act_pass', create('loc_docks', 'loc_varn', 'periodic_classifier'))
    await act('act_flood', {
      kind: 'updateEntity',
      source: 'user_edit',
      payload: {
        branchId: 'b1',
        id: 'loc_docks',
        patch: { state: { parent_location_id: 'loc_varn', condition: 'flooded' } },
      },
    })

    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: await deltasOf('act_varn', 'act_flood'),
    })

    expect(labels(set)).toEqual([
      'update entities:loc_docks',
      'create entities:loc_docks',
      'create entities:loc_varn',
    ])
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

    expect(labels(set)).toEqual([
      'update entities:loc_old',
      'update entities:loc_old',
      'create entities:loc_varn',
    ])
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

    expect(labels(set)).toEqual(['update entities:loc_old', 'create entities:loc_varn'])
    await reverse(set)
    const [holder] = await deltasOf('act_del')
    expect(holder.undoPayload?.state).toEqual({ parent_location_id: 'loc_quarter' })
  })

  it('takes a place the set moved off a removed parent, since the reversal puts it back', async () => {
    await act('act_varn', create('loc_varn', null, 'user_edit'))
    await act('act_pass', create('loc_docks', 'loc_varn', 'periodic_classifier'))
    await act('act_move', move('loc_docks', 'loc_quarter'))

    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: await deltasOf('act_varn', 'act_move'),
    })

    expect(labels(set)).toEqual([
      'update entities:loc_docks',
      'create entities:loc_docks',
      'create entities:loc_varn',
    ])
    await reverse(set)
    expect(await entityIds()).toEqual(['loc_quarter'])
  })

  it('takes a held child whose copy names a removed parent, pruning its delete', async () => {
    await act('act_varn', create('loc_varn', null, 'user_edit'))
    await act('act_pass', create('loc_docks', 'loc_varn', 'periodic_classifier'))
    await act('act_del', remove('loc_docks'))

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf('act_varn') })

    expect(labels(set)).toEqual(['create entities:loc_docks', 'create entities:loc_varn'])
    await reverse(set)
    expect(await ctx.db.select().from(deltas)).toEqual([])
    expect(await entityIds()).toEqual(['loc_quarter'])
  })

  it('redoes a child CTRL-Z took through its parent, under that parent', async () => {
    await act('act_varn', create('loc_varn', null, 'user_edit'))
    await act('act_pass', create('loc_docks', 'loc_varn', 'periodic_classifier'))

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf('act_varn') })
    const { group, reverse: undo } = await prepareUndo(set, ctx)
    await undo()
    expect(await entityIds()).toEqual(['loc_quarter'])

    await applyRedo(group, ctx)
    expect(await entityIds()).toEqual(['loc_docks', 'loc_quarter', 'loc_varn'])
    expect(await parentOf('loc_docks')).toBe('loc_varn')
    expect((await deltasOf('act_pass')).map((d) => d.targetId)).toEqual(['loc_docks'])
  })

  it.each([
    ['the user made', true],
    ['the wizard or a seed made', false],
  ] as const)(
    'refuses a place %s that a write outside the set moved under a removed parent',
    async (_label, logged) => {
      if (logged) {
        await act('act_x', create('loc_x', null, 'user_edit'))
        await act('act_z', create('loc_z', 'loc_x', 'user_edit'))
      }
      const moved = logged ? 'loc_x' : 'loc_quarter'
      await act('act_pass', create('loc_p', null, 'periodic_classifier'))
      await act('act_move', move(moved, 'loc_p'))

      const selected = selectReversalSet(ctx, {
        branchId: 'b1',
        target: await deltasOf('act_pass'),
      })

      await expect(selected).rejects.toBeInstanceOf(ReversalIntegrityError)
      await expect(selected).rejects.toMatchObject({ refusal: 'moved-outside' })
    },
  )

  it('takes a child a write outside the set changed without moving it', async () => {
    await act('act_varn', create('loc_varn', null, 'user_edit'))
    await act('act_pass', create('loc_docks', 'loc_varn', 'periodic_classifier'))
    await act('act_flood', {
      kind: 'updateEntity',
      source: 'user_edit',
      payload: {
        branchId: 'b1',
        id: 'loc_docks',
        patch: { state: { parent_location_id: 'loc_varn', condition: 'flooded' } },
      },
    })

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf('act_varn') })

    expect(labels(set)).toEqual([
      'update entities:loc_docks',
      'create entities:loc_docks',
      'create entities:loc_varn',
    ])
  })

  it("takes a removed place's own later move outside the set, as any later write", async () => {
    await act('act_varn', create('loc_varn', null, 'user_edit'))
    await act('act_move', move('loc_varn', 'loc_quarter'))

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf('act_varn') })

    expect(labels(set)).toEqual(['update entities:loc_varn', 'create entities:loc_varn'])
  })
})
