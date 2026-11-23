import { and, asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { DeltaSource, PipelineAction } from '@/lib/actions'
import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'
import { reverseAndPruneDeltaRows } from '@/lib/actions/delta/reverse-replay'
import { selectReversalSet } from '@/lib/actions/delta/row-closure'
import {
  branches,
  dbSchema,
  deltas,
  entities,
  happeningAwareness,
  happenings,
  lore,
  stories,
  type CharacterState,
  type DbCtx,
  type Delta,
  type NewDelta,
  type NewEntity,
  type NewLore,
} from '@/lib/db'
import { createTestDb, makeBatchCallback, makeCallback } from '@/lib/db/__tests__/test-db'
import { resetAllStores } from '@/lib/stores'

import { DiffWalkError, walkTarget, type UpdateDelta } from './diff-walk'
import { isRetrievalBump } from './link-rows'
import { loadHistoryChunk } from './query'

// architecture.md → Walk algorithm. Every expectation is a literal this file wrote, never a value
// read back through the walk.

type TestDb = Awaited<ReturnType<typeof createTestDb>>

let t: TestDb
let ctx: DbCtx

beforeEach(async () => {
  t = await createTestDb()
  ctx = { db: t.db, runInTransaction: t.runInTransaction }
  await t.db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await t.db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'main', createdAt: 1 })
})

afterEach(() => {
  resetAllStores()
})

async function act(actionId: string, action: PipelineAction): Promise<void> {
  const result = await applyDeltaAction({ action, actionId, branchId: 'b1' }, ctx)
  if (result.status !== 'ok') throw new Error(`${actionId} did not land: ${JSON.stringify(result)}`)
}

async function deltasOf(actionId: string): Promise<Delta[]> {
  return (await t.db
    .select()
    .from(deltas)
    .where(and(eq(deltas.branchId, 'b1'), eq(deltas.actionId, actionId)))
    .orderBy(asc(deltas.logPosition))) as Delta[]
}

async function only(actionId: string): Promise<Delta> {
  const rows = await deltasOf(actionId)
  if (rows.length !== 1) throw new Error(`${actionId} logged ${rows.length} deltas, not one`)
  return rows[0]
}

async function onlyUpdate(actionId: string): Promise<UpdateDelta> {
  const delta = await only(actionId)
  if (delta.op !== 'update') throw new Error(`${actionId} logged a ${delta.op}, not an update`)
  return { ...delta, op: delta.op }
}

// The test database behind callbacks that count the walk's reads, and can fail a single query or
// land a write right after a batch returns.
function spiedDb() {
  const reads = { batch: 0, single: 0 }
  const hooks: { afterBatch: (() => Promise<void>) | null; failSingle: Error | null } = {
    afterBatch: null,
    failSingle: null,
  }
  const single = makeCallback(t.sqlite)
  const batch = makeBatchCallback(t.sqlite)
  const db = drizzle(
    async (query, params, method) => {
      reads.single += 1
      if (hooks.failSingle != null) throw hooks.failSingle
      return single(query, params, method)
    },
    async (queries) => {
      reads.batch += 1
      const results = await batch(queries)
      const write = hooks.afterBatch
      hooks.afterBatch = null
      if (write != null) await write()
      return results
    },
    { schema: dbSchema },
  )
  return { db, reads, hooks }
}

const CHARACTER_STATE: CharacterState = {
  visual: { attire: 'travel cloak' },
  traits: ['brave'],
  drives: [],
  current_location_id: null,
  equipped_items: [],
  inventory: [],
  faction_id: null,
  lastSeenAt: null,
}

const entity = (id: string, name: string, over: Partial<NewEntity> = {}): NewEntity => ({
  id,
  branchId: 'b1',
  kind: 'character',
  name,
  status: 'active',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

const updateEntity = (id: string, patch: Record<string, unknown>): PipelineAction => ({
  kind: 'updateEntity',
  source: 'user_edit',
  payload: { branchId: 'b1', id, patch },
})

const deleteEntity = (id: string): PipelineAction => ({
  kind: 'deleteEntity',
  source: 'user_edit',
  payload: { branchId: 'b1', id },
})

const FORD: NewLore = {
  id: 'lore_ford',
  branchId: 'b1',
  title: 'The ford',
  body: 'Shallow in summer.',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
}

const createFord: PipelineAction = {
  kind: 'createLore',
  source: 'user_edit',
  payload: { entry: FORD },
}

const editFord = (patch: { title?: string; body?: string | null }): PipelineAction => ({
  kind: 'updateLore',
  source: 'user_edit',
  payload: { branchId: 'b1', id: 'lore_ford', patch, proseEntryId: null },
})

// char_kael < char_mira, so Kael is side a and holds `kind`.
const relate = (kind: string): PipelineAction => ({
  kind: 'upsertCharacterRelationship',
  source: 'user_edit',
  payload: {
    branchId: 'b1',
    subjectId: 'char_kael',
    objectId: 'char_mira',
    kind,
    inverseKind: null,
  },
})

/** Kael and Mira, a relationship between them, and one update of its `kind`: friend → rival. */
async function seedRelationship(): Promise<{ update: UpdateDelta; relationshipId: string }> {
  await t.db.insert(entities).values([entity('char_kael', 'Kael'), entity('char_mira', 'Mira')])
  await act('act_rel', relate('friend'))
  await act('act_rival', relate('rival'))
  return { update: await onlyUpdate('act_rival'), relationshipId: (await only('act_rel')).targetId }
}

const KAEL_FLAGGED: Partial<NewEntity> = {
  nameCollisionFlag: 1,
  nameCollisionPartnerId: 'char_kaelan',
  nameCollisionReason: 'duplicate',
}

const RIVAL = { old: { kind: 'friend' }, new: { kind: 'rival' }, names: {} }

const loreDelta = (over: Partial<UpdateDelta> = {}): UpdateDelta => ({
  id: 'dl_1',
  branchId: 'b1',
  entryId: null,
  actionId: 'act_1',
  logPosition: 1,
  source: 'user_edit',
  targetTable: 'lore',
  targetId: 'lore_ford',
  op: 'update',
  undoPayload: { title: 'The ford' },
  encodingVersion: 1,
  createdAt: 1,
  ...over,
})

describe('walkTarget', () => {
  it('gives each of three state updates its payload as old and the state just after it as new', async () => {
    await t.db.insert(entities).values(entity('char_kael', 'Kael', { state: CHARACTER_STATE }))
    const scarred = { ...CHARACTER_STATE, traits: ['brave', 'scarred'] }
    const driven = { ...CHARACTER_STATE, traits: ['brave', 'scarred'], drives: ['revenge'] }
    const hardened = { ...CHARACTER_STATE, traits: ['scarred'], drives: ['revenge'] }
    await act('act_1', updateEntity('char_kael', { state: scarred }))
    await act('act_2', updateEntity('char_kael', { state: driven }))
    await act('act_3', updateEntity('char_kael', { state: hardened }))
    const [first, second, third] = [
      await onlyUpdate('act_1'),
      await onlyUpdate('act_2'),
      await onlyUpdate('act_3'),
    ]

    const result = await walkTarget(t.db, [first, second, third])

    expect(result.gone.size).toBe(0)
    expect(new Set(result.entries.keys())).toEqual(new Set([first.id, second.id, third.id]))
    expect(result.entries.get(first.id)).toEqual({
      old: { state: { traits: ['brave'] } },
      new: { state: scarred },
      names: {},
    })
    expect(result.entries.get(second.id)).toEqual({
      old: { state: { drives: [] } },
      new: { state: driven },
      names: {},
    })
    expect(result.entries.get(third.id)).toEqual({
      old: { state: { traits: ['brave', 'scarred'] } },
      new: { state: hardened },
      names: {},
    })
  })

  it("seeds a deleted lore row from its delete's payload", async () => {
    await act('act_0', createFord)
    await act('act_1', editFord({ body: 'A drowning in spring.' }))
    await act('act_2', {
      kind: 'deleteLore',
      source: 'user_edit',
      payload: { branchId: 'b1', id: 'lore_ford' },
    })
    const update = await onlyUpdate('act_1')

    const result = await walkTarget(t.db, [update])

    expect(result.entries.get(update.id)).toEqual({
      old: { body: 'Shallow in summer.' },
      new: { body: 'A drowning in spring.' },
      names: {},
    })
  })

  it("seeds a relationship removed with its character from the copy the character's delete holds", async () => {
    const { update } = await seedRelationship()
    await act('act_del_mira', deleteEntity('char_mira'))
    const spied = spiedDb()

    const result = await walkTarget(spied.db, [update])

    expect(result.entries.get(update.id)).toEqual(RIVAL)
    expect(result.gone.size).toBe(0)
    expect(spied.reads).toEqual({ batch: 1, single: 1 })
  })

  it('seeds from the held row with the target id when the delete holds several', async () => {
    await t.db
      .insert(entities)
      .values([
        entity('char_aaron', 'Aaron'),
        entity('char_kael', 'Kael'),
        entity('char_mira', 'Mira'),
      ])
    await act('act_aaron', {
      kind: 'upsertCharacterRelationship',
      source: 'user_edit',
      payload: {
        branchId: 'b1',
        subjectId: 'char_aaron',
        objectId: 'char_mira',
        kind: 'sibling',
        inverseKind: null,
      },
    })
    await act('act_rel', relate('friend'))
    await act('act_rival', relate('rival'))
    const aaronLink = (await only('act_aaron')).targetId
    const relationshipId = (await only('act_rel')).targetId
    const update = await onlyUpdate('act_rival')
    await act('act_del_mira', deleteEntity('char_mira'))
    const [holder] = await deltasOf('act_del_mira')
    // The target held second: a walk taking the first held row would seed from Aaron's link.
    expect((holder.undoPayload?.relationships as { id: string }[]).map((row) => row.id)).toEqual([
      aaronLink,
      relationshipId,
    ])

    const result = await walkTarget(t.db, [update])

    expect(result.entries.get(update.id)).toEqual(RIVAL)
  })

  it("ignores a held copy in another branch's delete", async () => {
    const { update, relationshipId } = await seedRelationship()
    await act('act_del_mira', deleteEntity('char_mira'))
    await t.db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'alt', createdAt: 2 })
    await t.db.insert(deltas).values({
      id: 'dl_b2_holder',
      branchId: 'b2',
      entryId: null,
      actionId: 'act_b2',
      logPosition: 9999,
      source: 'user_edit',
      targetTable: 'entities',
      targetId: 'char_mira',
      op: 'delete',
      undoPayload: { id: 'char_mira', relationships: [{ id: relationshipId, kind: 'lover' }] },
      createdAt: 9999,
    })

    const result = await walkTarget(t.db, [update])

    expect(result.entries.get(update.id)).toEqual(RIVAL)
  })

  it('rejects a target with no row, no head delete and no held copy', async () => {
    const ghost: NewDelta = {
      id: 'dl_ghost',
      branchId: 'b1',
      entryId: null,
      actionId: 'act_ghost',
      logPosition: 1000,
      source: 'user_edit',
      targetTable: 'character_relationships',
      targetId: 'rel_ghost',
      op: 'update',
      undoPayload: { kind: 'friend' },
      createdAt: 1000,
    }
    await t.db.insert(deltas).values(ghost)
    const update = await onlyUpdate('act_ghost')

    await expect(walkTarget(t.db, [update])).rejects.toThrow(DiffWalkError)
    await expect(walkTarget(t.db, [update])).rejects.toThrow(
      'no row, head delete or held copy for character_relationships rel_ghost',
    )
  })

  it('resolves deltas missing from their chain as gone, before looking for a seed', async () => {
    const pruned = loreDelta({ id: 'dl_pruned', targetId: 'lore_gone' })

    await expect(walkTarget(t.db, [pruned])).resolves.toEqual({
      entries: new Map(),
      gone: new Set(['dl_pruned']),
    })
  })

  it('gives the chained deltas their entries when others in the request are gone', async () => {
    await act('act_0', createFord)
    await act('act_1', editFord({ body: 'A drowning in spring.' }))
    const update = await onlyUpdate('act_1')
    const pruned = loreDelta({ id: 'dl_pruned', logPosition: update.logPosition - 1 })

    const result = await walkTarget(t.db, [pruned, update])

    expect(result.gone).toEqual(new Set(['dl_pruned']))
    expect(result.entries.get(update.id)).toEqual({
      old: { body: 'Shallow in summer.' },
      new: { body: 'A drowning in spring.' },
      names: {},
    })
  })

  it('puts no $ key in old or new', async () => {
    await t.db.insert(entities).values([
      entity('char_kaelan', 'Kaelan'),
      entity('char_kael', 'Kael', {
        nameCollisionFlag: 1,
        nameCollisionPartnerId: 'char_kaelan',
        nameCollisionReason: 'alike',
      }),
    ])
    await act(
      'act_1',
      updateEntity('char_kael', {
        nameCollisionFlag: 0,
        nameCollisionPartnerId: null,
        nameCollisionReason: null,
      }),
    )
    const update = await onlyUpdate('act_1')
    expect(Object.keys(update.undoPayload ?? {})).toContain('$resolvedPair')

    const result = await walkTarget(t.db, [update])

    // Strict: toEqual would pass a `$` key carried with an undefined value.
    expect(result.entries.get(update.id)).toStrictEqual({
      old: {
        nameCollisionFlag: 1,
        nameCollisionPartnerId: 'char_kaelan',
        nameCollisionReason: 'alike',
      },
      new: { nameCollisionFlag: 0, nameCollisionPartnerId: null, nameCollisionReason: null },
      names: { char_kaelan: 'Kaelan' },
    })
  })

  it('fills new with the whole collision group as each re-point left it', async () => {
    await t.db
      .insert(entities)
      .values([
        entity('char_kaelan', 'Kaelan'),
        entity('char_kaelen', 'Kaelen'),
        entity('char_kaelyn', 'Kaelyn'),
        entity('char_kael', 'Kael', KAEL_FLAGGED),
      ])
    await act('act_1', updateEntity('char_kael', { nameCollisionPartnerId: 'char_kaelen' }))
    await act(
      'act_2',
      updateEntity('char_kael', {
        nameCollisionPartnerId: 'char_kaelyn',
        nameCollisionReason: 'name-taken',
      }),
    )
    const [first, second] = [await onlyUpdate('act_1'), await onlyUpdate('act_2')]
    expect(first.undoPayload).toStrictEqual({ nameCollisionPartnerId: 'char_kaelan' })
    expect(second.undoPayload).toStrictEqual({
      nameCollisionPartnerId: 'char_kaelen',
      nameCollisionReason: 'duplicate',
    })

    const result = await walkTarget(t.db, [first, second])

    const names = { char_kaelan: 'Kaelan', char_kaelen: 'Kaelen', char_kaelyn: 'Kaelyn' }
    expect(result.entries.get(first.id)).toStrictEqual({
      old: { nameCollisionPartnerId: 'char_kaelan' },
      new: {
        nameCollisionFlag: 1,
        nameCollisionPartnerId: 'char_kaelen',
        nameCollisionReason: 'duplicate',
      },
      names,
    })
    expect(result.entries.get(second.id)).toStrictEqual({
      old: { nameCollisionPartnerId: 'char_kaelen', nameCollisionReason: 'duplicate' },
      new: {
        nameCollisionFlag: 1,
        nameCollisionPartnerId: 'char_kaelyn',
        nameCollisionReason: 'name-taken',
      },
      names,
    })
  })

  it('gives a clear alongside another column the cleared group and that column', async () => {
    await t.db
      .insert(entities)
      .values([entity('char_kaelan', 'Kaelan'), entity('char_kael', 'Kael', KAEL_FLAGGED)])
    await act(
      'act_1',
      updateEntity('char_kael', {
        description: 'a wandering knight',
        nameCollisionFlag: 0,
        nameCollisionPartnerId: null,
        nameCollisionReason: null,
      }),
    )
    const update = await onlyUpdate('act_1')

    const result = await walkTarget(t.db, [update])

    expect(result.entries.get(update.id)).toStrictEqual({
      old: {
        description: null,
        nameCollisionFlag: 1,
        nameCollisionPartnerId: 'char_kaelan',
        nameCollisionReason: 'duplicate',
      },
      new: {
        description: 'a wandering knight',
        nameCollisionFlag: 0,
        nameCollisionPartnerId: null,
        nameCollisionReason: null,
      },
      names: { char_kaelan: 'Kaelan' },
    })
  })

  it("gives a classifier's raise the group it set", async () => {
    await t.db
      .insert(entities)
      .values([entity('char_kaelan', 'Kaelan'), entity('char_kael', 'Kael')])
    await act('act_1', {
      kind: 'raiseCollisionFlag',
      source: 'periodic_classifier',
      payload: {
        branchId: 'b1',
        id: 'char_kael',
        partnerId: 'char_kaelan',
        reason: 'duplicate',
        proseEntryId: null,
      },
    })
    const raise = await onlyUpdate('act_1')

    const result = await walkTarget(t.db, [raise])

    expect(result.entries.get(raise.id)).toStrictEqual({
      old: { nameCollisionFlag: 0, nameCollisionPartnerId: null, nameCollisionReason: null },
      new: {
        nameCollisionFlag: 1,
        nameCollisionPartnerId: 'char_kaelan',
        nameCollisionReason: 'duplicate',
      },
      names: { char_kaelan: 'Kaelan' },
    })
  })

  it("leaves a flagged row's other edits without the collision group", async () => {
    await t.db
      .insert(entities)
      .values([entity('char_kaelan', 'Kaelan'), entity('char_kael', 'Kael', KAEL_FLAGGED)])
    await act('act_1', updateEntity('char_kael', { description: 'a wandering knight' }))
    const update = await onlyUpdate('act_1')

    const result = await walkTarget(t.db, [update])

    expect(result.entries.get(update.id)).toStrictEqual({
      old: { description: null },
      new: { description: 'a wandering knight' },
      names: {},
    })
  })

  it('steps back through a parent-only payload on a place a reversal left unplaced, parent and mark as one field', async () => {
    const place = (id: string, parent: string | null): NewEntity =>
      entity(id, id, { kind: 'location', state: { parent_location_id: parent } })
    await t.db.insert(entities).values(place('loc_quarter', null))
    await act('act_old', {
      kind: 'createEntity',
      source: 'piggyback_tagged_block',
      payload: { entry: place('loc_old', 'loc_quarter') },
    })
    await act(
      'act_flood',
      updateEntity('loc_old', {
        state: { parent_location_id: 'loc_quarter', condition: 'flooded' },
      }),
    )
    await act('act_varn', {
      kind: 'createEntity',
      source: 'periodic_classifier',
      payload: { entry: place('loc_varn', null) },
    })
    await act(
      'act_move',
      updateEntity('loc_old', { state: { parent_location_id: 'loc_varn', condition: 'flooded' } }),
    )
    const flood = await onlyUpdate('act_flood')
    const move = await onlyUpdate('act_move')
    expect(move.undoPayload).toEqual({ state: { parent_location_id: 'loc_quarter' } })
    // Reversing the parent's create clears the ref and logs nothing (generation-pipeline.md →
    // Reverse-replay), so the move's payload stays parent-only against an unplaced row.
    await reverseAndPruneDeltaRows(
      await selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf('act_varn') }),
      ctx,
      { keepRedoExact: false },
    )
    const [row] = await t.db
      .select()
      .from(entities)
      .where(and(eq(entities.branchId, 'b1'), eq(entities.id, 'loc_old')))
    expect(row.state).toEqual({ parent_location_id: null, unplaced: true, condition: 'flooded' })

    const result = await walkTarget(t.db, [flood, move])

    expect(result.entries.get(move.id)).toEqual({
      old: { state: { parent_location_id: 'loc_quarter' } },
      new: { state: { parent_location_id: null, unplaced: true, condition: 'flooded' } },
      names: { loc_quarter: 'loc_quarter' },
    })
    expect(result.entries.get(flood.id)).toEqual({
      old: { state: { condition: null } },
      new: { state: { parent_location_id: 'loc_quarter', condition: 'flooded' } },
      names: { loc_quarter: 'loc_quarter' },
    })
  })

  it('steps back through retrieval bumps between two listed awareness updates and lists no bump', async () => {
    await t.db.insert(entities).values(entity('char_aria', 'Aria'))
    await t.db.insert(happenings).values({
      id: 'hap_fire',
      branchId: 'b1',
      title: 'The keep burns',
      createdAt: 1,
      updatedAt: 1,
    })
    const aware = (
      writer: DeltaSource,
      fields: { source?: string; decayResistance?: number; retrievalCount?: number },
    ): PipelineAction => ({
      kind: 'upsertHappeningAwareness',
      source: writer,
      payload: {
        branchId: 'b1',
        characterId: 'char_aria',
        happeningId: 'hap_fire',
        proseEntryId: null,
        ...fields,
      },
    })
    await act('act_0', aware('periodic_classifier', {}))
    const awarenessId = (await only('act_0')).targetId
    const bump = (priorCount: number): PipelineAction => ({
      kind: 'bumpAwarenessRetrieval',
      source: 'ai_classifier',
      payload: { branchId: 'b1', id: awarenessId, priorCount },
    })
    // A close's merge is the writer that may set the count, so both listed updates carry one.
    await act('act_1', aware('chapter_close', { source: 'overheard', retrievalCount: 3 }))
    await act('act_b1', bump(3))
    await act('act_b2', bump(4))
    await act('act_2', aware('chapter_close', { decayResistance: 0.8, retrievalCount: 9 }))
    const first = await onlyUpdate('act_1')
    const second = await onlyUpdate('act_2')
    const bumps = [await only('act_b1'), await only('act_b2')]
    expect(first.undoPayload).toEqual({ source: null, retrievalCount: 0 })
    expect(second.undoPayload).toEqual({ decayResistance: null, retrievalCount: 5 })

    const result = await walkTarget(t.db, [first, second])

    expect(new Set(result.entries.keys())).toEqual(new Set([first.id, second.id]))
    expect(result.entries.get(first.id)).toEqual({
      old: { source: null, retrievalCount: 0 },
      new: { source: 'overheard', retrievalCount: 3 },
      names: {},
    })
    expect(result.entries.get(second.id)).toEqual({
      old: { decayResistance: null, retrievalCount: 5 },
      new: { decayResistance: 0.8, retrievalCount: 9 },
      names: {},
    })
    for (const bumped of bumps) expect(result.entries.has(bumped.id)).toBe(false)
  })

  it('reads the chain and the row in one batch, and nothing more for a target with no refs', async () => {
    await act('act_0', createFord)
    await act('act_1', editFord({ body: 'A drowning in spring.' }))
    const update = await onlyUpdate('act_1')
    const spied = spiedDb()

    await walkTarget(spied.db, [update])

    expect(spied.reads).toEqual({ batch: 1, single: 0 })
  })

  it('gives a forward update landing just after the read the entry of a walk wholly before it', async () => {
    await act('act_0', createFord)
    await act('act_1', editFord({ body: 'A drowning in spring.' }))
    const update = await onlyUpdate('act_1')
    const spied = spiedDb()
    spied.hooks.afterBatch = () => act('act_2', editFord({ body: 'Ice in winter.' }))

    const result = await walkTarget(spied.db, [update])

    expect(result.entries.get(update.id)).toEqual({
      old: { body: 'Shallow in summer.' },
      new: { body: 'A drowning in spring.' },
      names: {},
    })
    const [row] = await t.db
      .select()
      .from(lore)
      .where(and(eq(lore.branchId, 'b1'), eq(lore.id, 'lore_ford')))
    expect(row.body).toBe('Ice in winter.')
    expect(spied.reads).toEqual({ batch: 1, single: 0 })
  })

  it('walks a live link row whose own delete lands just after the read', async () => {
    const { update, relationshipId } = await seedRelationship()
    const spied = spiedDb()
    spied.hooks.afterBatch = () =>
      act('act_unlink', {
        kind: 'deleteCharacterRelationship',
        source: 'user_edit',
        payload: { branchId: 'b1', id: relationshipId },
      })

    const result = await walkTarget(spied.db, [update])

    expect(result.entries.get(update.id)).toEqual(RIVAL)
    expect(await deltasOf('act_unlink')).toHaveLength(1)
    expect(spied.reads).toEqual({ batch: 1, single: 0 })
  })

  it("keeps the held copy when the link's other end is deleted between the read and the held-copy read", async () => {
    const { update } = await seedRelationship()
    await act('act_del_mira', deleteEntity('char_mira'))
    const spied = spiedDb()
    spied.hooks.afterBatch = () => act('act_del_kael', deleteEntity('char_kael'))

    const result = await walkTarget(spied.db, [update])

    expect(result.entries.get(update.id)).toEqual(RIVAL)
    expect(await deltasOf('act_del_kael')).toHaveLength(1)
    expect(spied.reads).toEqual({ batch: 1, single: 1 })
  })

  it("names a live ref from its row and a deleted one from its delete's payload", async () => {
    const faction = (id: string, name: string) => entity(id, name, { kind: 'faction', state: {} })
    await t.db
      .insert(entities)
      .values([
        faction('fac_old', 'Old Guard'),
        faction('fac_iron', 'Iron Pact'),
        entity('char_kael', 'Kael', { state: { ...CHARACTER_STATE, faction_id: 'fac_old' } }),
      ])
    await act(
      'act_1',
      updateEntity('char_kael', { state: { ...CHARACTER_STATE, faction_id: 'fac_iron' } }),
    )
    await act('act_2', deleteEntity('fac_old'))
    const update = await onlyUpdate('act_1')

    const result = await walkTarget(t.db, [update])

    expect(result.entries.get(update.id)).toEqual({
      old: { state: { faction_id: 'fac_old' } },
      new: { state: { ...CHARACTER_STATE, faction_id: 'fac_iron' } },
      names: { fac_old: 'Old Guard', fac_iron: 'Iron Pact' },
    })
  })

  it('rejects with the database error when the names read fails', async () => {
    await t.db
      .insert(entities)
      .values([
        entity('fac_iron', 'Iron Pact', { kind: 'faction', state: {} }),
        entity('char_kael', 'Kael', { state: CHARACTER_STATE }),
      ])
    await act(
      'act_1',
      updateEntity('char_kael', { state: { ...CHARACTER_STATE, faction_id: 'fac_iron' } }),
    )
    const update = await onlyUpdate('act_1')
    const failure = new Error('disk I/O error')
    const spied = spiedDb()
    spied.hooks.failSingle = failure

    const error = await walkTarget(spied.db, [update]).then(
      () => null,
      (e: unknown) => e,
    )

    // drizzle wraps a single query's failure; the walk adds nothing around it.
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(DiffWalkError)
    expect((error as Error).cause).toBe(failure)
    expect(spied.reads.batch).toBe(1)
  })

  it('refuses an empty list, mixed targets, a non-update and a table History does not list', async () => {
    await expect(walkTarget(t.db, [])).rejects.toThrow(DiffWalkError)
    await expect(walkTarget(t.db, [])).rejects.toThrow('mixed targets')
    await expect(
      walkTarget(t.db, [loreDelta(), loreDelta({ id: 'dl_2', targetId: 'lore_tide' })]),
    ).rejects.toThrow('mixed targets')
    await expect(
      walkTarget(t.db, [loreDelta(), loreDelta({ id: 'dl_2', branchId: 'b2' })]),
    ).rejects.toThrow('mixed targets')
    const removal: Delta = { ...loreDelta(), op: 'delete' }
    // @ts-expect-error a non-update is refused by the type, and the walk still checks
    await expect(walkTarget(t.db, [removal])).rejects.toThrow('mixed targets')
    await expect(walkTarget(t.db, [loreDelta({ targetTable: 'chapters' })])).rejects.toThrow(
      DiffWalkError,
    )
  })
})

describe('isRetrievalBump', () => {
  it('leaves out exactly the awareness updates the History query leaves out', async () => {
    await t.db.insert(entities).values(entity('char_aria', 'Aria'))
    await t.db.insert(happenings).values({
      id: 'hap_fire',
      branchId: 'b1',
      title: 'The keep burns',
      createdAt: 1,
      updatedAt: 1,
    })
    await t.db
      .insert(happeningAwareness)
      .values({ id: 'haw_fire', branchId: 'b1', happeningId: 'hap_fire', characterId: 'char_aria' })
    const update = (
      id: string,
      logPosition: number,
      undoPayload: Record<string, unknown>,
    ): NewDelta => ({
      id,
      branchId: 'b1',
      entryId: null,
      actionId: `act_${id}`,
      logPosition,
      source: 'ai_classifier',
      targetTable: 'happening_awareness',
      targetId: 'haw_fire',
      op: 'update',
      undoPayload,
      createdAt: logPosition,
    })
    await t.db.insert(deltas).values([
      update('dl_bare', 1, { retrievalCount: 0 }),
      update('dl_meta', 2, { retrievalCount: 1, $machinePin: true }),
      update('dl_mixed', 3, { retrievalCount: 2, source: null }),
      // One key that isn't the count, as a single-field awareness edit writes.
      update('dl_source', 4, { source: null }),
      update('dl_decay', 5, { decayResistance: 0.5 }),
    ])
    const written = (await t.db
      .select()
      .from(deltas)
      .where(eq(deltas.targetId, 'haw_fire'))
      .orderBy(asc(deltas.logPosition))) as Delta[]

    expect(written.map((d) => [d.id, isRetrievalBump(d)])).toEqual([
      ['dl_bare', true],
      ['dl_meta', false],
      ['dl_mixed', false],
      ['dl_source', false],
      ['dl_decay', false],
    ])
    const chunk = await loadHistoryChunk(t.db, {
      branchId: 'b1',
      targetTable: 'entities',
      targetId: 'char_aria',
      sort: 'oldest',
      cursor: null,
    })
    const listed = chunk.rows.map((row) => row.delta.id)
    expect(listed).toEqual(['dl_meta', 'dl_mixed', 'dl_source', 'dl_decay'])
    expect(listed).toEqual(written.filter((d) => !isRetrievalBump(d)).map((d) => d.id))
    const walked = await walkTarget(
      t.db,
      await Promise.all(written.map((d) => onlyUpdate(d.actionId))),
    )
    expect(new Set(walked.entries.keys())).toEqual(
      new Set(['dl_meta', 'dl_mixed', 'dl_source', 'dl_decay']),
    )
  })

  it('is false off the awareness table, for a create, and for an empty payload', () => {
    expect(
      isRetrievalBump({
        targetTable: 'entities',
        op: 'update',
        undoPayload: { retrievalCount: 1 },
      }),
    ).toBe(false)
    expect(
      isRetrievalBump({
        targetTable: 'happening_awareness',
        op: 'create',
        undoPayload: { retrievalCount: 1 },
      }),
    ).toBe(false)
    expect(
      isRetrievalBump({ targetTable: 'happening_awareness', op: 'update', undoPayload: null }),
    ).toBe(false)
  })
})
