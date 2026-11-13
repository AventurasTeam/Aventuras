import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { entities, storyEntries, type Entity, type EntityState } from '@/lib/db'
import { resetAllStores } from '@/lib/stores'

import { CloseIds } from './ids'
import { planPlacement, type PlacementArg } from './placement'
import type { WriteContext } from './tool'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'

const place = (n: number): string => `loc_00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const ROWS = {
  quay: place(1),
  harrow: place(2),
  oldKeep: place(3),
  cellar: place(4),
  marsh: place(5),
  landing: place(6),
  varn: place(7),
  loopA: place(8),
  loopB: place(9),
  // Named by the ferry house's parent; never seeded.
  gone: place(10),
  ferryHouse: place(11),
  yard: place(12),
  oldCellar: place(13),
  tobin: 'char_00000000-0000-4000-8000-000000000014',
} as const

type RowSeed = {
  id: string
  kind: Entity['kind']
  name: string
  status?: Entity['status']
  injectionMode?: Entity['injectionMode']
  state: Readonly<Record<string, unknown>>
}

// Inserted with no delta: the plan reads rows, and a looping chain can't be written through actions.
async function putRow(fx: CloseFixture, row: RowSeed): Promise<void> {
  await fx.ctx.db.insert(entities).values({
    id: row.id,
    branchId: fx.branchId,
    kind: row.kind,
    name: row.name,
    description: null,
    status: row.status ?? 'active',
    retiredReason: row.status === 'retired' ? 'Burned down.' : null,
    injectionMode: row.injectionMode ?? 'auto',
    state: row.state as EntityState,
    keywords: [],
    createdAt: 1,
    updatedAt: 1,
  })
}

const top = { parent_location_id: null }
const under = (parentId: string) => ({ parent_location_id: parentId })

async function seedPlaces(fx: CloseFixture): Promise<void> {
  await putRow(fx, { id: ROWS.quay, kind: 'location', name: 'The quay', state: top })
  await putRow(fx, { id: ROWS.harrow, kind: 'location', name: 'Harrow', state: top })
  await putRow(fx, {
    id: ROWS.oldKeep,
    kind: 'location',
    name: 'The old keep',
    status: 'retired',
    state: top,
  })
  await putRow(fx, {
    id: ROWS.cellar,
    kind: 'location',
    name: 'The cellar',
    state: under(ROWS.quay),
  })
  await putRow(fx, {
    id: ROWS.oldCellar,
    kind: 'location',
    name: 'The old cellar',
    status: 'retired',
    state: under(ROWS.quay),
  })
  await putRow(fx, {
    id: ROWS.marsh,
    kind: 'location',
    name: 'The marsh',
    injectionMode: 'disabled',
    state: top,
  })
  await putRow(fx, { id: ROWS.landing, kind: 'location', name: 'The landing', state: top })
  await putRow(fx, {
    id: ROWS.varn,
    kind: 'location',
    name: 'Varn',
    state: { parent_location_id: null, unplaced: true },
  })
  await putRow(fx, { id: ROWS.loopA, kind: 'location', name: 'Loop A', state: under(ROWS.loopB) })
  await putRow(fx, { id: ROWS.loopB, kind: 'location', name: 'Loop B', state: under(ROWS.loopA) })
  await putRow(fx, {
    id: ROWS.ferryHouse,
    kind: 'location',
    name: 'The ferry house',
    state: under(ROWS.gone),
  })
  await putRow(fx, {
    id: ROWS.yard,
    kind: 'location',
    name: 'The keep yard',
    state: under(ROWS.oldKeep),
  })
  await putRow(fx, { id: ROWS.tobin, kind: 'character', name: 'Tobin', state: {} })
}

// The tail and the scene source are both the branch's last reply; its location is the story's.
async function setStoryPlace(fx: CloseFixture, placeId: string): Promise<void> {
  const where = and(
    eq(storyEntries.branchId, fx.branchId),
    eq(storyEntries.id, fx.entries.at(-1)!.id),
  )
  const [row] = await fx.ctx.db
    .select({ metadata: storyEntries.metadata })
    .from(storyEntries)
    .where(where)
  if (!row?.metadata) throw new Error('setStoryPlace: the last entry has no metadata')
  await fx.ctx.db
    .update(storyEntries)
    .set({ metadata: { ...row.metadata, currentLocationId: placeId } })
    .where(where)
}

async function rowOf(fx: CloseFixture, id: string): Promise<Entity> {
  const [row] = await fx.ctx.db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, fx.branchId), eq(entities.id, id)))
  if (row === undefined) throw new Error(`no row ${id}`)
  return row
}

// planPlacement reads rows and the story's place only: no guard, no ids.
function writeContextFor(fx: CloseFixture): WriteContext {
  const endEntryId = fx.entries[6]!.id
  return {
    db: fx.ctx.db,
    branchId: fx.branchId,
    endEntryId,
    task: 'upkeep',
    part: 1,
    taskEntryIds: [endEntryId],
    ids: new CloseIds(),
    readFields: {},
    survivorOf: () => undefined,
    landedCalls: () => 0,
    turns: [endEntryId],
    proseEntryId: endEntryId,
    guard: async () => {
      throw new Error('planPlacement reads no guard')
    },
    actionId: 'act_placement_test',
  }
}

const LANDS_UNDER = (parentId: string) => ({
  ok: true,
  restated: false,
  wanted: { 'state.parent_location_id': parentId },
  removed: ['state.unplaced'],
})
const LANDS_TOP = {
  ok: true,
  restated: false,
  wanted: { 'state.parent_location_id': null },
  removed: ['state.unplaced'],
}
const RESTATED = { ok: true, restated: true, wanted: {}, removed: [] }

describe('planPlacement', () => {
  let fx: CloseFixture

  beforeEach(async () => {
    fx = await openCloseFixture()
    await seedPlaces(fx)
    await setStoryPlace(fx, ROWS.landing)
  })

  afterEach(() => {
    resetAllStores()
  })

  const plan = async (id: string, arg: PlacementArg) =>
    planPlacement(await rowOf(fx, id), arg, writeContextFor(fx))
  const underOf = (parentId: string): PlacementArg => ({ kind: 'under', parentId })

  it('places a row under a live place, clearing the unplaced mark in the same write', async () => {
    expect(await plan(ROWS.varn, underOf(ROWS.harrow))).toEqual(LANDS_UNDER(ROWS.harrow))
    expect(await plan(ROWS.quay, underOf(ROWS.harrow))).toEqual(LANDS_UNDER(ROWS.harrow))
  })

  it('marks an unplaced row top level, and one whose parent names no place', async () => {
    expect(await plan(ROWS.varn, { kind: 'top' })).toEqual(LANDS_TOP)
    expect(await plan(ROWS.ferryHouse, { kind: 'top' })).toEqual(LANDS_TOP)
  })

  // placeLocation's first check: a stored placement is restated before any rule judges it.
  it('restates the stored placement before any rule, under a now-retired parent too', async () => {
    expect(await plan(ROWS.yard, underOf(ROWS.oldKeep))).toEqual(RESTATED)
    expect(await plan(ROWS.cellar, underOf(ROWS.quay))).toEqual(RESTATED)
    expect(await plan(ROWS.quay, { kind: 'top' })).toEqual(RESTATED)
  })

  it('refuses top on a placed row', async () => {
    expect(await plan(ROWS.cellar, { kind: 'top' })).toEqual({ ok: false, reason: 'not-unplaced' })
  })

  it('refuses a parent that is no place on the branch: a character, or a missing row', async () => {
    expect(await plan(ROWS.quay, underOf(ROWS.tobin))).toEqual({
      ok: false,
      reason: 'parent-not-a-place',
    })
    expect(await plan(ROWS.quay, underOf(ROWS.gone))).toEqual({
      ok: false,
      reason: 'parent-not-a-place',
    })
  })

  it('refuses a retired parent', async () => {
    expect(await plan(ROWS.harrow, underOf(ROWS.oldKeep))).toEqual({
      ok: false,
      reason: 'retired-parent',
    })
  })

  it('refuses a loop: under its own child, or under itself', async () => {
    expect(await plan(ROWS.quay, underOf(ROWS.cellar))).toEqual({
      ok: false,
      reason: 'parent-cycle',
    })
    expect(await plan(ROWS.quay, underOf(ROWS.quay))).toEqual({ ok: false, reason: 'parent-cycle' })
  })

  it('refuses a parent whose own chain loops as a broken chain', async () => {
    expect(await plan(ROWS.quay, underOf(ROWS.loopA))).toEqual({
      ok: false,
      reason: 'parent-chain-broken',
    })
  })

  // The old cellar is retired and inside the quay: the retired check comes first, as in the handler.
  it('judges a retired parent before the walk', async () => {
    expect(await plan(ROWS.quay, underOf(ROWS.oldCellar))).toEqual({
      ok: false,
      reason: 'retired-parent',
    })
  })

  it('refuses moving the place that holds the story, or one around it, under a disabled place', async () => {
    expect(await plan(ROWS.landing, underOf(ROWS.marsh))).toEqual({
      ok: false,
      reason: 'story-inside',
    })
    await setStoryPlace(fx, ROWS.cellar)
    expect(await plan(ROWS.quay, underOf(ROWS.marsh))).toEqual({
      ok: false,
      reason: 'story-inside',
    })
  })

  it('lands the same disabled parent for a place that does not hold the story', async () => {
    expect(await plan(ROWS.harrow, underOf(ROWS.marsh))).toEqual(LANDS_UNDER(ROWS.marsh))
  })
})
