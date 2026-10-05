import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  branches,
  characterRelationships,
  deltas,
  entities,
  happeningAwareness,
  happenings,
  stories,
  storyEntries,
  type ClassifierStatus,
  type Delta,
  type NewEntity,
  type StoryDefinition,
  type StoryEntry,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entitiesStore, entriesStore, resetAllStores } from '@/lib/stores'

import { applyDeltaAction } from './apply-delta-action'
import { heldKey, loadHeldRows } from './held-rows'
import { REF_COLUMNS, rowRefs } from './live-refs'
import { resolveByTable } from './registry'
import { reverseReplayDeltas } from './reverse-replay'
import { deleteEntityRow } from '../row-delete/delete-entity'
import { deleteRow } from '../row-delete/delete-row'
import { updateStoryEntryContent } from '../story-entries/operational'
import { redoLastAction, undoLastAction } from '../story-entries/undo'
import type { DbCtx, DeltaSource, PipelineAction } from '../types'

let ctx: DbCtx

const character = (id: string, name: string): NewEntity => ({
  id,
  branchId: 'b1',
  kind: 'character',
  name,
  status: 'active',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
})

const entry = (id: string, position: number, kind: StoryEntry['kind']): StoryEntry => ({
  id,
  branchId: 'b1',
  position,
  kind,
  content: `${id} content`,
  chapterId: null,
  metadata: null,
  createdAt: position,
})

const delta = (
  id: string,
  logPosition: number,
  actionId: string,
  source: Delta['source'],
  targetTable: string,
  targetId: string,
  op: Delta['op'],
  undoPayload: Record<string, unknown> | null = null,
): Delta => ({
  id,
  branchId: 'b1',
  actionId,
  op,
  targetTable,
  targetId,
  entryId: null,
  source,
  undoPayload,
  logPosition,
  encodingVersion: 1,
  createdAt: logPosition,
})

const status = (processedThrough: number): ClassifierStatus => ({
  state: 'idle',
  lastSuccessAt: null,
  lastError: null,
  retryCount: 0,
  processedThrough,
})

beforeEach(async () => {
  resetAllStores()
  const t = await createTestDb()
  ctx = { db: t.db, runInTransaction: t.runInTransaction }
  await ctx.db.insert(stories).values({
    id: 's1',
    title: 'T',
    definition: { leadEntityId: 'char_lead' } as StoryDefinition,
    createdAt: 1,
    updatedAt: 1,
  })
  await ctx.db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  // No create deltas, like rows the wizard writes: the closure never reaches them, since
  // they name nothing.
  await ctx.db
    .insert(entities)
    .values([character('char_lead', 'Kael'), character('char_x', 'Mira')])
  entitiesStore.hydrate('b1', await ctx.db.select().from(entities))
  entriesStore.hydrate('b1', [])
})

afterEach(() => resetAllStores())

function act(actionId: string, entryId: string | null = null) {
  return async (action: PipelineAction): Promise<void> => {
    const result = await applyDeltaAction({ action, actionId, branchId: 'b1', entryId }, ctx)
    if (result.status !== 'ok') throw new Error(`${action.kind} refused: ${result.reason}`)
  }
}

const createCharacter = (id: string, name: string, source: DeltaSource): PipelineAction => ({
  kind: 'createEntity',
  source,
  payload: { entry: character(id, name) },
})

const createHappening = (id: string): PipelineAction => ({
  kind: 'createHappening',
  source: 'periodic_classifier',
  payload: { entry: { id, branchId: 'b1', title: id, createdAt: 2, updatedAt: 2 } },
})

const involve = (id: string, happeningId: string, entityId: string): PipelineAction => ({
  kind: 'createHappeningInvolvement',
  source: 'periodic_classifier',
  payload: { entry: { id, branchId: 'b1', happeningId, entityId } },
})

const aware = (happeningId: string, characterId: string): PipelineAction => ({
  kind: 'upsertHappeningAwareness',
  source: 'periodic_classifier',
  payload: { branchId: 'b1', happeningId, characterId },
})

const relate = (
  subjectId: string,
  objectId: string,
  kind: string,
  source: DeltaSource,
): PipelineAction => ({
  kind: 'upsertCharacterRelationship',
  source,
  payload: { branchId: 'b1', subjectId, objectId, kind, inverseKind: kind },
})

async function undo(): Promise<void> {
  expect(await undoLastAction('b1', ctx)).toEqual({ status: 'ok' })
}

async function redo(): Promise<void> {
  expect(await redoLastAction('b1', ctx)).toEqual({ status: 'ok' })
}

// The orchestrator's abortRun reverses a failed run this way. In production the no-gate write
// lock keeps a user write out of a pass's burst, so these interleavings are not a reachable
// abort: driving the reversal directly pins the planner.
async function abort(actionId: string): Promise<void> {
  await reverseReplayDeltas(actionId, ctx)
}

async function deleteEntity(id: string): Promise<void> {
  expect(await deleteEntityRow('b1', id, ctx)).toEqual({ status: 'ok' })
}

async function deleteHappening(id: string): Promise<void> {
  expect(await deleteRow('happening', 'b1', id, ctx)).toEqual({ status: 'ok' })
}

async function editProse(id: string, content: string): Promise<void> {
  expect(await updateStoryEntryContent('b1', id, content, ctx)).toEqual({ status: 'ok' })
}

// Every step of every scenario ends on invariant 1, labelled so a failure names the step.
async function step(label: string, run: () => Promise<void>): Promise<void> {
  await run()
  await expectNoDanglingRefs(label)
}

function registered(table: string) {
  const registration = resolveByTable(table)
  if (!registration) throw new Error(`${table} is not registered`)
  return registration
}

async function liveIds(table: string): Promise<string[]> {
  const { descriptor } = registered(table)
  const rows = (await ctx.db.select({ id: descriptor.idCol }).from(descriptor.table)) as {
    id: string
  }[]
  return rows.map((row) => row.id)
}

async function isLive(table: string, id: string): Promise<boolean> {
  return (await liveIds(table)).includes(id)
}

async function onlyId(table: string): Promise<string> {
  const ids = await liveIds(table)
  expect(ids, table).toHaveLength(1)
  return ids[0]
}

async function deltasOn(id: string): Promise<Delta[]> {
  return (await ctx.db.select().from(deltas).where(eq(deltas.targetId, id))) as Delta[]
}

async function proseOf(id: string): Promise<string> {
  const [row] = await ctx.db
    .select({ content: storyEntries.content })
    .from(storyEntries)
    .where(eq(storyEntries.id, id))
  return row.content
}

async function heldRow(table: string, id: string) {
  return (await loadHeldRows(ctx, 'b1')).byRow.get(heldKey(table, id))
}

/** Invariant 1: a live row names only live rows; a held row names only live or held ones. */
async function expectNoDanglingRefs(label: string): Promise<void> {
  const refTables = new Set(
    Object.values(REF_COLUMNS).flatMap((columns) => columns.map((column) => column.refTable)),
  )
  const live = new Set<string>()
  for (const table of refTables) for (const id of await liveIds(table)) live.add(heldKey(table, id))
  const held = await loadHeldRows(ctx, 'b1')
  const dangling: string[] = []
  for (const table of Object.keys(REF_COLUMNS)) {
    const rows = (await ctx.db.select().from(registered(table).descriptor.table)) as Record<
      string,
      unknown
    >[]
    for (const row of rows)
      for (const ref of rowRefs(table, row))
        if (!live.has(heldKey(ref.table, ref.id)))
          dangling.push(`live ${table}:${String(row.id)} names ${ref.table}:${ref.id}`)
  }
  for (const row of held.byRow.values())
    for (const ref of rowRefs(row.table, row.row)) {
      const key = heldKey(ref.table, ref.id)
      if (!live.has(key) && !held.byRow.has(key))
        dangling.push(`held ${row.table}:${row.id} (delta ${row.holder.id}) names ${key}`)
    }
  // Thrown, not asserted: toEqual's message truncates the array, and the self-tests match the rows in it.
  if (dangling.length > 0) throw new Error(`${label}: ${dangling.join('; ')}`)
}

/** Invariant 2: absent from its table, and neither the log nor a delete's payload restores it. */
async function expectGoneForGood(table: string, id: string): Promise<void> {
  expect(await isLive(table, id), `${table}:${id} is live`).toBe(false)
  expect(await deltasOn(id), `${table}:${id} still has deltas`).toEqual([])
  expect(await heldRow(table, id), `${table}:${id} is held`).toBeUndefined()
}

async function expectLiveWithCreate(table: string, id: string): Promise<void> {
  expect(await isLive(table, id), `${table}:${id} is live`).toBe(true)
  const creates = (await deltasOn(id)).filter((d) => d.op === 'create' && d.targetTable === table)
  expect(creates, `${table}:${id} create delta`).toHaveLength(1)
}

describe('expectNoDanglingRefs', () => {
  it('flags a live link naming a row that exists nowhere', async () => {
    await ctx.db.insert(happeningAwareness).values({
      id: 'haw_planted',
      branchId: 'b1',
      happeningId: 'hap_gone',
      characterId: 'char_x',
    })
    await expect(expectNoDanglingRefs('planted')).rejects.toThrow(/hap_gone/)
  })

  it('flags a held row naming a row that exists nowhere', async () => {
    await ctx.db.insert(deltas).values(
      delta('d_planted', 1, 'act_planted', 'user_edit', 'entities', 'char_gone', 'delete', {
        ...character('char_gone', 'Gone'),
        relationships: [
          {
            id: 'rel_planted',
            branchId: 'b1',
            aId: 'char_gone',
            bId: 'char_nowhere',
            kind: 'ally',
            inverseKind: null,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    )
    await expect(expectNoDanglingRefs('planted')).rejects.toThrow(/char_nowhere/)
  })
})

describe('reversal integrity scenarios', () => {
  it('CTRL-Z of a user-created character takes the links a pass made to her; redo restores them', async () => {
    await step('user create', () =>
      act('act_user')(createCharacter('char_new', 'Nia', 'user_edit')),
    )
    const pass = act('act_pass')
    await step('pass happening', () => pass(createHappening('hap_p')))
    await step('pass involvement', () => pass(involve('hinv_p', 'hap_p', 'char_new')))
    await step('pass awareness', () => pass(aware('hap_p', 'char_new')))
    await step('pass relationship', () =>
      pass(relate('char_new', 'char_x', 'ally', 'periodic_classifier')),
    )
    const awarenessId = await onlyId('happening_awareness')
    const relationshipId = await onlyId('character_relationships')
    const taken = [
      ['entities', 'char_new'],
      ['happening_involvements', 'hinv_p'],
      ['happening_awareness', awarenessId],
      ['character_relationships', relationshipId],
    ] as const

    await step('CTRL-Z', undo)
    for (const [table, id] of taken) await expectGoneForGood(table, id)
    // Named by a removed link, not naming a removed row: the closure leaves it.
    await expectLiveWithCreate('happenings', 'hap_p')

    await step('redo', redo)
    for (const [table, id] of taken) await expectLiveWithCreate(table, id)

    await step('second CTRL-Z', undo)
    for (const [table, id] of taken) await expectGoneForGood(table, id)
  })

  it('aborting a pass that created a character takes the user relationship to her, delta and all', async () => {
    await step('pass create', () =>
      act('act_pass')(createCharacter('char_p', 'Pell', 'periodic_classifier')),
    )
    await step('user link', () => act('act_user')(relate('char_p', 'char_x', 'ally', 'user_edit')))
    const relationshipId = await onlyId('character_relationships')

    await step('abort', () => abort('act_pass'))
    await expectGoneForGood('entities', 'char_p')
    await expectGoneForGood('character_relationships', relationshipId)
    expect(await isLive('entities', 'char_x')).toBe(true)
  })

  it("aborting a pass takes a user relationship a delete holds that names the pass's character", async () => {
    await step('pass create', () =>
      act('act_pass')(createCharacter('char_p', 'Pell', 'periodic_classifier')),
    )
    await step('user link', () => act('act_user')(relate('char_p', 'char_x', 'ally', 'user_edit')))
    const relationshipId = await onlyId('character_relationships')
    await step('delete', () => deleteEntity('char_x'))
    expect((await heldRow('character_relationships', relationshipId))?.place).toBe('captured')

    await step('abort', () => abort('act_pass'))
    await expectGoneForGood('entities', 'char_p')
    await expectGoneForGood('character_relationships', relationshipId)
    expect((await heldRow('entities', 'char_x'))?.place).toBe('target')

    await step('CTRL-Z', undo)
    expect(await isLive('entities', 'char_x')).toBe(true)
    await expectGoneForGood('character_relationships', relationshipId)
  })

  it('an abort strips a captured relationship from an entity delete; undoing the delete leaves it gone', async () => {
    await step('pass link', () =>
      act('act_pass')(relate('char_lead', 'char_x', 'ally', 'periodic_classifier')),
    )
    const relationshipId = await onlyId('character_relationships')
    await step('delete', () => deleteEntity('char_x'))
    expect((await heldRow('character_relationships', relationshipId))?.place).toBe('captured')

    await step('abort', () => abort('act_pass'))
    await expectGoneForGood('character_relationships', relationshipId)
    // Stripped, not pruned: the delete still holds its own row.
    expect((await heldRow('entities', 'char_x'))?.place).toBe('target')

    await step('CTRL-Z', undo)
    expect(await isLive('entities', 'char_x')).toBe(true)
    await expectGoneForGood('character_relationships', relationshipId)
  })

  it('an abort strips captured awareness from a happening delete the same way', async () => {
    await ctx.db
      .insert(happenings)
      .values({ id: 'hap_old', branchId: 'b1', title: 'Old', createdAt: 1, updatedAt: 1 })
    await step('pass awareness', () => act('act_pass')(aware('hap_old', 'char_x')))
    const awarenessId = await onlyId('happening_awareness')
    await step('delete', () => deleteHappening('hap_old'))
    expect((await heldRow('happening_awareness', awarenessId))?.place).toBe('captured')

    await step('abort', () => abort('act_pass'))
    await expectGoneForGood('happening_awareness', awarenessId)
    expect((await heldRow('happenings', 'hap_old'))?.place).toBe('target')

    await step('CTRL-Z', undo)
    expect(await isLive('happenings', 'hap_old')).toBe(true)
    await expectGoneForGood('happening_awareness', awarenessId)
  })

  it('an abort prunes the deletes of rows the pass created; CTRL-Z reaches the group beneath', async () => {
    await step('earlier user create', () =>
      act('act_prev')(createCharacter('char_prev', 'Oren', 'user_edit')),
    )
    const pass = act('act_pass')
    await step('pass happening', () => pass(createHappening('hap_p')))
    await step('pass character', () =>
      pass(createCharacter('char_p', 'Pell', 'periodic_classifier')),
    )
    await step('happening delete', () => deleteHappening('hap_p'))
    await step('entity delete', () => deleteEntity('char_p'))

    await step('abort', () => abort('act_pass'))
    // No delta targets either row any more: their creates and their deletes are gone.
    await expectGoneForGood('happenings', 'hap_p')
    await expectGoneForGood('entities', 'char_p')

    await step('CTRL-Z', undo)
    expect(await isLive('entities', 'char_prev')).toBe(false)
    await expectGoneForGood('happenings', 'hap_p')
    await expectGoneForGood('entities', 'char_p')
    expect(await undoLastAction('b1', ctx)).toMatchObject({
      status: 'rejected',
      code: 'nothing-to-apply',
    })
  })

  it('an abort patches a captured relationship back to its earlier view; undoing the delete restores it so', async () => {
    await step('user link', () => act('act_u0')(relate('char_lead', 'char_x', 'ally', 'user_edit')))
    await step('pass update', () =>
      act('act_pass')(relate('char_lead', 'char_x', 'rival', 'periodic_classifier')),
    )
    const relationshipId = await onlyId('character_relationships')
    await step('delete', () => deleteEntity('char_x'))
    expect((await heldRow('character_relationships', relationshipId))?.row).toMatchObject({
      kind: 'rival',
      inverseKind: 'rival',
    })

    await step('abort', () => abort('act_pass'))
    expect(await ctx.db.select().from(deltas).where(eq(deltas.actionId, 'act_pass'))).toEqual([])
    expect((await heldRow('character_relationships', relationshipId))?.row).toMatchObject({
      kind: 'ally',
      inverseKind: 'ally',
    })

    await step('CTRL-Z', undo)
    const [restored] = await ctx.db
      .select()
      .from(characterRelationships)
      .where(eq(characterRelationships.id, relationshipId))
    expect(restored).toMatchObject({ kind: 'ally', inverseKind: 'ally' })
  })

  it('a prose edit sweeps facts two deletes hold, and no undo or redo after it brings them back', async () => {
    const entries = [entry('e_opening', 1, 'opening'), entry('e_a', 2, 'ai_reply')]
    await ctx.db.insert(storyEntries).values(entries)
    await ctx.db
      .insert(deltas)
      .values([
        delta('d_open', 1, 'act_open', 'user_edit', 'story_entries', 'e_opening', 'create'),
        delta('d_a', 2, 'act_a', 'ai_classifier', 'story_entries', 'e_a', 'create'),
      ])
    await ctx.db
      .update(branches)
      .set({ classifierStatus: status(2) })
      .where(eq(branches.id, 'b1'))
    entriesStore.hydrate('b1', entries)

    await step('earlier pass', () => act('act_old', 'e_opening')(createHappening('hap_old')))
    const pass = act('act_pass', 'e_a')
    await step('pass relationship', () =>
      pass(relate('char_lead', 'char_x', 'ally', 'periodic_classifier')),
    )
    await step('pass awareness', () => pass(aware('hap_old', 'char_x')))
    await step('pass happening', () => pass(createHappening('hap_p')))
    const relationshipId = await onlyId('character_relationships')
    const awarenessId = await onlyId('happening_awareness')
    const swept = [
      ['character_relationships', relationshipId],
      ['happening_awareness', awarenessId],
      ['happenings', 'hap_p'],
    ] as const

    await step('entity delete', () => deleteEntity('char_x'))
    await step('happening delete', () => deleteHappening('hap_p'))

    await step('edit', () => editProse('e_a', 'rewritten'))
    // Includes hap_p's delete: it held the row whose create the sweep reversed, so it is pruned.
    for (const [table, id] of swept) await expectGoneForGood(table, id)
    expect((await heldRow('entities', 'char_x'))?.place).toBe('target')

    await step('CTRL-Z of the edit', undo)
    expect(await proseOf('e_a')).toBe('e_a content')
    for (const [table, id] of swept) await expectGoneForGood(table, id)

    await step('redo of the edit', redo)
    expect(await proseOf('e_a')).toBe('rewritten')
    for (const [table, id] of swept) await expectGoneForGood(table, id)

    await step('second CTRL-Z of the edit', undo)
    expect(await proseOf('e_a')).toBe('e_a content')

    // The entity delete: the happening delete went with the edit's sweep.
    await step('CTRL-Z of the entity delete', undo)
    expect(await isLive('entities', 'char_x')).toBe(true)
    for (const [table, id] of swept) await expectGoneForGood(table, id)

    await step('redo of the entity delete', redo)
    expect(await isLive('entities', 'char_x')).toBe(false)
    for (const [table, id] of swept) await expectGoneForGood(table, id)
  })
})
