import { and, desc, eq, inArray } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  branches,
  deltas,
  entities,
  sourceHash,
  type CharacterState,
  type DbCtx,
  type Delta,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  branchSnapshot,
  cloneBranch,
  seedCopyFixture,
  type BranchSnapshot,
  type CopyFixture,
  type TestDb,
} from '@/lib/db/__tests__/two-branch'
import { plantVec } from '@/lib/db/__tests__/vec-fixtures'
import { entitiesStore, entriesStore, generationStore, undoRedoStore } from '@/lib/stores'

import { applyDeltaAction } from './apply-delta-action'
import { __resetBranchWriteLocks } from './branch-write-lock'
import { __resetRegistrationGuard, registerAllDomains } from './registrations'
import { __resetRegistry, register } from './registry'
import { buildReverseAndPrunePlan, type PlanTarget, type ReversePlan } from './reverse-replay'
import { selectReversalSet, type ReversalSet } from './row-closure'
import type { DeltaSource, PipelineAction } from '../types'

// The parent is seedCopyFixture's branch. CHILD takes a plan made on the parent, as a fork's
// child does; SELF is a plain copy of the parent that reverses the same group on itself.
const PARENT: CopyFixture['branchId'] = 'br_a'
const CHILD = 'br_wb_child'
const SELF = 'br_wb_self'

const STATE: CharacterState = {
  visual: { attire: 'travel cloak' },
  traits: ['brave'],
  drives: [],
  voice: 'low and dry',
  current_location_id: null,
  equipped_items: [],
  inventory: [],
  faction_id: null,
  lastSeenAt: null,
}

// generation-pipeline.md → Reverse-replay: a cleared parent leaves the place unplaced.
const UNPLACED = { parent_location_id: null, unplaced: true }

let t: TestDb
let ctx: DbCtx
let fx: CopyFixture

beforeEach(async () => {
  generationStore.__reset()
  undoRedoStore.__reset()
  t = await createTestDb()
  ctx = { db: t.db, runInTransaction: t.runInTransaction }
  fx = await seedCopyFixture(t)
})

afterEach(() => {
  __resetBranchWriteLocks()
  entitiesStore.__reset()
  entriesStore.__reset()
  generationStore.__reset()
  undoRedoStore.__reset()
})

const character = (id: string, over: Partial<NewEntity> = {}): NewEntity => ({
  id,
  branchId: PARENT,
  kind: 'character',
  name: id,
  status: 'active',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

const place = (id: string, parent: string | null): NewEntity =>
  character(id, { kind: 'location', state: { parent_location_id: parent } })

const create = (source: DeltaSource, entry: NewEntity): PipelineAction => ({
  kind: 'createEntity',
  source,
  payload: { entry },
})

const passView = (subjectId: string, objectId: string, kind: string): PipelineAction => ({
  kind: 'upsertCharacterRelationship',
  source: 'periodic_classifier',
  payload: { branchId: PARENT, subjectId, objectId, kind, proseEntryId: null },
})

const userPair = (
  subjectId: string,
  objectId: string,
  kind: string | null,
  inverseKind: string | null,
): PipelineAction => ({
  kind: 'upsertCharacterRelationship',
  source: 'user_edit',
  payload: { branchId: PARENT, subjectId, objectId, kind, inverseKind },
})

const updateState = (source: DeltaSource, id: string, state: CharacterState): PipelineAction => ({
  kind: 'updateEntity',
  source,
  payload: { branchId: PARENT, id, patch: { state } },
})

async function act(actionId: string, action: PipelineAction): Promise<void> {
  const result = await applyDeltaAction({ action, actionId, branchId: PARENT }, ctx)
  if (result.status !== 'ok') throw new Error(`${actionId} did not land: ${JSON.stringify(result)}`)
}

async function groupOn(branchId: string, actionIds: readonly string[]): Promise<Delta[]> {
  return (await ctx.db
    .select()
    .from(deltas)
    .where(and(eq(deltas.branchId, branchId), inArray(deltas.actionId, [...actionIds])))
    .orderBy(desc(deltas.logPosition))) as Delta[]
}

async function deltaOn(branchId: string, id: string): Promise<Delta | undefined> {
  const [row] = (await ctx.db
    .select()
    .from(deltas)
    .where(and(eq(deltas.branchId, branchId), eq(deltas.id, id)))) as Delta[]
  return row
}

async function entityOn(branchId: string, id: string) {
  const [row] = await ctx.db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, branchId), eq(entities.id, id)))
  return row
}

const withoutBranch = (snapshot: BranchSnapshot): BranchSnapshot =>
  Object.fromEntries(
    Object.entries(snapshot).map(([table, rows]) => [
      table,
      rows.map(({ branch_id: _branch, ...row }) => row),
    ]),
  )

function vectorIdsOn(branchId: string): string[] {
  const rows = t.sqlite
    .prepare('SELECT id FROM entities_vec_384 WHERE branch_id = ?')
    .all(branchId) as { id: string }[]
  return rows.map((row) => row.id).sort()
}

const parentVectorIds = (): string[] => vectorIdsOn(PARENT)

type ParentState = { rows: BranchSnapshot; vectorIds: string[] }

function parentState(): ParentState {
  return { rows: branchSnapshot(t.sqlite, PARENT), vectorIds: parentVectorIds() }
}

type Planned = { set: ReversalSet; plan: ReversePlan }

// As a fork plans: the child's branches row alone, then the plan read on the parent.
async function planOnParent(actionIds: readonly string[]): Promise<Planned> {
  await ctx.db.insert(branches).values({
    id: CHILD,
    storyId: fx.storyId,
    parentBranchId: PARENT,
    name: CHILD,
    createdAt: 2,
  })
  const set = await selectReversalSet(ctx, {
    branchId: PARENT,
    target: await groupOn(PARENT, actionIds),
  })
  const plan = await buildReverseAndPrunePlan(
    set,
    ctx,
    { keepRedoExact: false },
    { writeBranchId: CHILD },
  )
  return { set, plan }
}

// The reference: SELF reverses the same group on itself, as every shipped reversal does.
async function reverseSelf(actionIds: readonly string[]): Promise<void> {
  const set = await selectReversalSet(ctx, {
    branchId: SELF,
    target: await groupOn(SELF, actionIds),
  })
  const plan = await buildReverseAndPrunePlan(set, ctx, { keepRedoExact: false })
  await ctx.runInTransaction([...plan.ops, ...plan.pruneOps, ...plan.journalOps])
}

function expectChildIsSelf(before: ParentState): void {
  expect(withoutBranch(branchSnapshot(t.sqlite, CHILD))).toEqual(
    withoutBranch(branchSnapshot(t.sqlite, SELF)),
  )
  expect(branchSnapshot(t.sqlite, PARENT)).toEqual(before.rows)
  expect(parentVectorIds()).toEqual(before.vectorIds)
}

// D1: no op the plan emits binds the parent, so none can write it.
const boundValues = (plan: ReversePlan): unknown[] =>
  [...plan.ops, ...plan.pruneOps, ...plan.journalOps].flatMap((op) => op.params)

async function forkAgainstSelf(
  actionIds: readonly string[],
  onChildCloned: () => void = () => {},
): Promise<Planned> {
  const before = parentState()
  cloneBranch(t.sqlite, PARENT, SELF)
  const planned = await planOnParent(actionIds)
  cloneBranch(t.sqlite, PARENT, CHILD)
  onChildCloned()
  const { plan } = planned
  await ctx.runInTransaction([...plan.ops, ...plan.pruneOps, ...plan.journalOps])
  await reverseSelf(actionIds)

  expectChildIsSelf(before)
  expect(boundValues(plan)).not.toContain(PARENT)
  return planned
}

// The user's later edit keeps the pass's pair, which deleting char_wb_p holds in its payload.
async function seedHeldPair(): Promise<{ created: Delta; holder: Delta }> {
  await act('act_wb_users', create('user_edit', character('char_wb_p')))
  await act('act_wb_users', create('user_edit', character('char_wb_y')))
  await act('act_wb_pass', passView('char_wb_p', 'char_wb_y', 'rival'))
  await act('act_wb_user', userPair('char_wb_p', 'char_wb_y', 'rival', 'mentor'))
  await act('act_wb_del', {
    kind: 'deleteEntity',
    source: 'user_edit',
    payload: { branchId: PARENT, id: 'char_wb_p' },
  })
  const [created] = await groupOn(PARENT, ['act_wb_pass'])
  const [holder] = await groupOn(PARENT, ['act_wb_del'])
  return { created, holder }
}

// A close's write a later pass overwrote: undoing the close rewrites the pass's prior value.
async function seedSurvivor(): Promise<{ survivor: Delta }> {
  await act('act_wb_kael', create('user_edit', character('char_wb_kael', { state: STATE })))
  await act(
    'act_wb_close',
    updateState('chapter_close', 'char_wb_kael', { ...STATE, voice: 'hoarse' }),
  )
  await act(
    'act_wb_steady',
    updateState('periodic_classifier', 'char_wb_kael', { ...STATE, voice: 'steady' }),
  )
  const [survivor] = await groupOn(PARENT, ['act_wb_steady'])
  return { survivor }
}

// A pass's state write with no later write: its undo lands on the row as read.
async function seedRedress(): Promise<{ stateBefore: unknown }> {
  await act('act_wb_sera', create('user_edit', character('char_wb_sera', { state: STATE })))
  const stateBefore = (await entityOn(PARENT, 'char_wb_sera'))?.state
  await act(
    'act_wb_dress',
    updateState('periodic_classifier', 'char_wb_sera', {
      ...STATE,
      visual: { attire: 'mail shirt' },
    }),
  )
  return { stateBefore }
}

// A user's place, a pass's place under it, and a vector for the user's place on the parent.
async function seedPlaces(): Promise<void> {
  await act('act_wb_varn', create('user_edit', place('loc_wb_varn', null)))
  await act('act_wb_docks', create('periodic_classifier', place('loc_wb_docks', 'loc_wb_varn')))
  plantVarnVector(PARENT)
}

function plantVarnVector(branchId: string): void {
  plantVec(t.sqlite, {
    kind: 'entity',
    id: 'loc_wb_varn',
    branchId,
    modelId: 'm384',
    dim: 384,
    sourceHash: sourceHash('h'),
    vector: new Uint8Array(new Float32Array(384).buffer),
  })
}

function capturedRowsOn(branchId: string): { relationships: number; awareness: number } {
  const id = fx.deletedCharacterId
  const count = (query: string, ...params: string[]): number =>
    (t.sqlite.prepare(query).get(...params) as { n: number }).n
  return {
    relationships: count(
      'SELECT count(*) AS n FROM character_relationships WHERE branch_id = ? AND (a_id = ? OR b_id = ?)',
      branchId,
      id,
      id,
    ),
    awareness: count(
      'SELECT count(*) AS n FROM happening_awareness WHERE branch_id = ? AND character_id = ?',
      branchId,
      id,
    ),
  }
}

describe('a plan with a write branch reads the parent and writes the child', () => {
  it('restores a deleted character and the rows its delete captured on the child', async () => {
    const { set, plan } = await forkAgainstSelf([fx.deleteActionId])

    expect(set.rows.some((d) => d.op === 'delete' && d.targetId === fx.deletedCharacterId)).toBe(
      true,
    )
    // The delete sits below the re-run's floor, so the drop rule takes its journal.
    expect(plan.droppedJournals.map((j) => j.actionId)).toEqual([fx.journalActionId])
    expect(plan.journalOps).toHaveLength(1)
    expect(await entityOn(CHILD, fx.deletedCharacterId)).toMatchObject({ branchId: CHILD })
    expect(await entityOn(PARENT, fx.deletedCharacterId)).toBeUndefined()
    expect(capturedRowsOn(CHILD)).toEqual({ relationships: 1, awareness: 1 })
    expect(capturedRowsOn(PARENT)).toEqual({ relationships: 0, awareness: 0 })
  })

  it('re-owns a kept create and rewrites the delete holding its row on the child', async () => {
    const { created, holder } = await seedHeldPair()

    const { plan } = await forkAgainstSelf(['act_wb_pass'])

    expect(plan.reownedDeltas).toEqual([created])
    expect(plan.rewrittenHolders).toEqual([holder])
    expect(await deltaOn(CHILD, created.id)).toMatchObject({
      source: 'user_edit',
      entryId: null,
      actionId: 'act_wb_user',
    })
    expect(await deltaOn(PARENT, created.id)).toEqual(created)
    expect((await deltaOn(CHILD, holder.id))?.undoPayload).not.toEqual(holder.undoPayload)
    expect(await deltaOn(PARENT, holder.id)).toEqual(holder)
  })

  it("rewrites a surviving later write's prior value on the child", async () => {
    const { survivor } = await seedSurvivor()

    const { plan } = await forkAgainstSelf(['act_wb_close'])

    expect(plan.survivorRewrites.map(({ delta }) => delta.id)).toEqual([survivor.id])
    expect((await deltaOn(CHILD, survivor.id))?.undoPayload).toEqual({
      state: { voice: 'low and dry' },
    })
    expect(await deltaOn(PARENT, survivor.id)).toEqual(survivor)
  })

  it('undoes an update onto the row as the parent holds it', async () => {
    const { stateBefore } = await seedRedress()

    await forkAgainstSelf(['act_wb_dress'])

    expect((await entityOn(CHILD, 'char_wb_sera'))?.state).toEqual(stateBefore)
    expect((await entityOn(PARENT, 'char_wb_sera'))?.state).toMatchObject({
      visual: { attire: 'mail shirt' },
    })
  })

  it('deletes a created place on the child and clears its child place there', async () => {
    await seedPlaces()

    const { set, plan } = await forkAgainstSelf(['act_wb_varn'], () => {
      plantVarnVector(CHILD)
      expect(vectorIdsOn(CHILD)).toEqual(['loc_wb_varn'])
    })

    expect(set.refClears.map((c) => `${c.row.id}.${c.ref.path}`)).toEqual([
      'loc_wb_docks.parent_location_id',
    ])
    expect(plan.ops.some((op) => op.sql.startsWith('DELETE FROM entities_vec_'))).toBe(true)
    expect(await entityOn(CHILD, 'loc_wb_varn')).toBeUndefined()
    expect((await entityOn(CHILD, 'loc_wb_docks'))?.state).toEqual(UNPLACED)
    expect(await entityOn(PARENT, 'loc_wb_varn')).toBeDefined()
    expect(vectorIdsOn(CHILD)).toEqual([])
    expect(parentVectorIds()).toEqual(['loc_wb_varn'])
  })
})

describe("the plan's fork lists", () => {
  it('splits out the writes a fork runs, keeping ops and pruneOps whole', async () => {
    const { created, holder } = await seedHeldPair()
    const { survivor } = await seedSurvivor()
    await seedPlaces()
    const targets = ['act_wb_pass', 'act_wb_close', 'act_wb_varn', fx.deleteActionId]
    const before = parentState()
    cloneBranch(t.sqlite, PARENT, SELF)

    const { plan } = await planOnParent(targets)

    expect(plan.ops).toEqual([...plan.writeOps, ...plan.sweepOps])
    expect(plan.sweepOps).not.toEqual([])
    expect(plan.sweepOps.every((op) => /^DELETE FROM entities_vec_\d+ WHERE/.test(op.sql))).toBe(
      true,
    )
    expect(plan.writeOps.some((op) => /_vec_\d+/.test(op.sql))).toBe(false)
    expect(plan.reownOps).toEqual(plan.pruneOps.filter((op) => op.sql.startsWith('update')))
    expect(plan.reownOps).toHaveLength(1)
    expect(plan.pruneOps.length).toBeGreaterThan(plan.reownOps.length)
    expect(plan.reownedDeltas).toEqual([created])
    expect(plan.rewrittenHolders).toEqual([holder])
    expect(plan.survivorRewrites.map(({ delta }) => delta.id)).toEqual([survivor.id])
    expect(plan.droppedJournals.map((j) => j.actionId)).toEqual([fx.journalActionId])
    expect(boundValues(plan)).not.toContain(PARENT)

    // The fork's copy: every delta but the prune set, every journal but the dropped ones.
    cloneBranch(t.sqlite, PARENT, CHILD)
    for (const { id } of plan.prunedDeltas)
      t.sqlite.prepare('DELETE FROM deltas WHERE branch_id = ? AND id = ?').run(CHILD, id)
    for (const { actionId } of plan.droppedJournals)
      t.sqlite
        .prepare('DELETE FROM reversal_journals WHERE branch_id = ? AND action_id = ?')
        .run(CHILD, actionId)
    await ctx.runInTransaction([...plan.writeOps, ...plan.reownOps])
    await reverseSelf(targets)

    expectChildIsSelf(before)
    expect(await deltaOn(CHILD, created.id)).toMatchObject({
      source: 'user_edit',
      actionId: 'act_wb_user',
    })
    expect((await deltaOn(CHILD, holder.id))?.undoPayload).not.toEqual(holder.undoPayload)
    expect((await deltaOn(CHILD, survivor.id))?.undoPayload).toEqual({
      state: { voice: 'low and dry' },
    })
  })
})

describe('a table with no branch column', () => {
  const branchless = sqliteTable('wb_branchless', { id: text('id').notNull() })

  afterEach(() => {
    __resetRegistry()
    __resetRegistrationGuard()
    registerAllDomains()
  })

  // A create on the parent of a row in a table every branch shares.
  async function planBranchlessCreate(target?: PlanTarget): Promise<ReversePlan> {
    t.sqlite.exec('CREATE TABLE wb_branchless (id TEXT PRIMARY KEY NOT NULL)')
    t.sqlite.prepare('INSERT INTO wb_branchless (id) VALUES (?)').run('row_wb_shared')
    register({
      table: 'wb_branchless',
      descriptor: { table: branchless, idCol: branchless.id },
      columnSchemas: {},
      handlers: {},
    })
    const { top } = t.sqlite
      .prepare('SELECT max(log_position) AS top FROM deltas WHERE branch_id = ?')
      .get(PARENT) as { top: number }
    const created: Delta = {
      id: 'delta_wb_branchless',
      branchId: PARENT,
      entryId: null,
      actionId: 'act_wb_branchless',
      logPosition: top + 1,
      source: 'user_edit',
      targetTable: 'wb_branchless',
      targetId: 'row_wb_shared',
      op: 'create',
      undoPayload: null,
      encodingVersion: 1,
      createdAt: 1,
    }
    await ctx.db.insert(deltas).values(created)
    const set = await selectReversalSet(ctx, { branchId: PARENT, target: [created] })
    return buildReverseAndPrunePlan(set, ctx, { keepRedoExact: false }, target)
  }

  const sharedRowIds = (): string[] =>
    (t.sqlite.prepare('SELECT id FROM wb_branchless').all() as { id: string }[]).map((r) => r.id)

  it("refuses a plan that writes another branch, which would write the parent's row", async () => {
    await expect(planBranchlessCreate({ writeBranchId: CHILD })).rejects.toThrow(/wb_branchless/)
    expect(sharedRowIds()).toEqual(['row_wb_shared'])
  })

  it('plans a reversal on its own branch', async () => {
    const plan = await planBranchlessCreate()

    await ctx.runInTransaction([...plan.ops, ...plan.pruneOps])
    expect(sharedRowIds()).toEqual([])
  })
})
