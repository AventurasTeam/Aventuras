import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  branches,
  deltas,
  entities,
  happeningInvolvements,
  happenings,
  stories,
  storyEntries,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  entitiesStore,
  entriesStore,
  generationStore,
  happeningInvolvementsStore,
  happeningsStore,
  undoRedoStore,
} from '@/lib/stores'
import { parentIdOf } from '@/lib/world'

import { shownCounts } from './__tests__/shown-counts'
import { rollbackToEntry } from './operational'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { __resetBranchWriteLocks } from '../delta/branch-write-lock'
import type { DbCtx, DeltaSource, PipelineAction } from '../types'

let ctx: DbCtx

const place = (id: string, name: string, parent: string | null): NewEntity => ({
  id,
  branchId: 'b1',
  kind: 'location',
  name,
  status: 'active',
  injectionMode: 'auto',
  state: { parent_location_id: parent },
  createdAt: 1,
  updatedAt: 1,
})

const createPlace = (entry: NewEntity, source: DeltaSource): PipelineAction => ({
  kind: 'createEntity',
  source,
  payload: { entry },
})

async function apply(action: PipelineAction, actionId: string, entryId: string): Promise<void> {
  const result = await applyDeltaAction({ action, actionId, branchId: 'b1', entryId }, ctx)
  expect(result.status).toBe('ok')
}

async function turn(id: string, position: number): Promise<void> {
  const action: PipelineAction = {
    kind: 'createStoryEntry',
    source: 'ai_classifier',
    payload: {
      entry: {
        id,
        branchId: 'b1',
        position,
        kind: 'ai_reply',
        content: id,
        metadata: { sceneEntities: [], currentLocationId: null, worldTime: position },
        createdAt: position,
      },
    },
  }
  const result = await applyDeltaAction({ action, actionId: `turn_${id}`, branchId: 'b1' }, ctx)
  expect(result.status).toBe('ok')
}

// The pass anchors the child, its own child and its happening on t1, all surviving.
async function passCreatesDocks(): Promise<void> {
  await apply(
    createPlace(place('loc_docks', 'Varn Docks', 'loc_varn'), 'periodic_classifier'),
    'act_pass',
    't1',
  )
  await apply(
    createPlace(place('loc_pier', 'Docks Pier', 'loc_docks'), 'periodic_classifier'),
    'act_pass',
    't1',
  )
  await apply(
    {
      kind: 'createHappening',
      source: 'periodic_classifier',
      payload: {
        entry: { id: 'hap_fire', branchId: 'b1', title: 'Fire', createdAt: 5, updatedAt: 5 },
      },
    },
    'act_pass',
    't1',
  )
  await apply(
    {
      kind: 'createHappeningInvolvement',
      source: 'periodic_classifier',
      payload: {
        entry: { id: 'hinv_docks', branchId: 'b1', happeningId: 'hap_fire', entityId: 'loc_docks' },
      },
    },
    'act_pass',
    't1',
  )
}

async function hydrateStores(): Promise<void> {
  entitiesStore.hydrate('b1', await ctx.db.select().from(entities))
  happeningsStore.hydrate('b1', await ctx.db.select().from(happenings))
  happeningInvolvementsStore.hydrate('b1', await ctx.db.select().from(happeningInvolvements))
  entriesStore.hydrate('b1', [])
}

async function entityIds(): Promise<string[]> {
  const rows = await ctx.db.select({ id: entities.id }).from(entities)
  return rows.map((row) => row.id).sort()
}

async function parentOf(id: string): Promise<string | null> {
  const [row] = await ctx.db.select().from(entities).where(eq(entities.id, id))
  return parentIdOf(row)
}

async function expectDocksUnplaced(): Promise<void> {
  expect(await entityIds()).toEqual(['loc_docks', 'loc_old', 'loc_pier'])
  expect(await parentOf('loc_docks')).toBeNull()
  expect(entitiesStore.getById('loc_docks')?.state).toEqual({
    parent_location_id: null,
    unplaced: true,
  })
  expect(entitiesStore.getById('loc_varn')).toBeUndefined()
  expect(await parentOf('loc_pier')).toBe('loc_docks')
  expect(entitiesStore.getById('loc_pier')?.state).toEqual({ parent_location_id: 'loc_docks' })
  expect(await ctx.db.select({ id: happeningInvolvements.id }).from(happeningInvolvements)).toEqual(
    [{ id: 'hinv_docks' }],
  )
  expect(happeningInvolvementsStore.getById('hinv_docks')).toBeDefined()
  expect(await ctx.db.select({ id: happenings.id }).from(happenings)).toEqual([{ id: 'hap_fire' }])
  const left = await ctx.db
    .select({ targetId: deltas.targetId })
    .from(deltas)
    .where(eq(deltas.targetTable, 'entities'))
  expect(left.map((d) => d.targetId).sort()).toEqual(['loc_docks', 'loc_pier'])
}

beforeEach(async () => {
  const t = await createTestDb()
  ctx = { db: t.db, runInTransaction: t.runInTransaction }
  await ctx.db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await ctx.db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  await ctx.db.insert(storyEntries).values({
    id: 'op',
    branchId: 'b1',
    position: 1,
    kind: 'opening',
    content: 'o',
    createdAt: 1,
  })
  await ctx.db.insert(entities).values(place('loc_old', 'Old Quarter', null))
  await turn('t1', 2)
  await turn('t2', 3)
  await turn('t3', 4)
})

afterEach(() => {
  __resetBranchWriteLocks()
  entitiesStore.__reset()
  entriesStore.__reset()
  generationStore.__reset()
  happeningsStore.__reset()
  happeningInvolvementsStore.__reset()
  undoRedoStore.clear()
})

describe('rolling back past a place parent anchored on a later turn than its child', () => {
  it('keeps a child the same pass anchored on an earlier turn, unplaced', async () => {
    await apply(
      createPlace(place('loc_varn', 'Varn', null), 'periodic_classifier'),
      'act_pass',
      't3',
    )
    await passCreatesDocks()
    await hydrateStores()
    const shown = await shownCounts('b1', 't2', ctx)

    const result = await rollbackToEntry('b1', 't2', ctx, { expectedCounts: shown })

    // The parent's create and the child's cleared parent: the preview counts the move too.
    expect(result).toEqual({
      status: 'ok',
      counts: { entries: 2, chapters: 0, worldStateChanges: 2 },
    })
    await expectDocksUnplaced()
  })

  it("keeps a pass's child of a place the parent's own turn created, unplaced", async () => {
    await apply(
      createPlace(place('loc_varn', 'Varn', null), 'piggyback_tagged_block'),
      'turn_t3',
      't3',
    )
    await passCreatesDocks()
    await hydrateStores()
    const shown = await shownCounts('b1', 't2', ctx)

    const result = await rollbackToEntry('b1', 't2', ctx, { expectedCounts: shown })

    expect(result.status).toBe('ok')
    await expectDocksUnplaced()
  })
})
