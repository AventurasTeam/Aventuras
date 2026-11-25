import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import {
  branches,
  characterRelationships,
  deleteBranchVecOps,
  emptyWorkingState,
  ensureVecTablesSql,
  entities,
  happeningAwareness,
  happenings,
  isVecFamilyTable,
  listVecFamilyTables,
  packFloat32,
  pipelineRuns,
  sourceHash,
  STORY_SETTINGS_DEFAULTS,
  stories,
  storyDefinitionSchema,
  wizardSessions,
  type BranchCopyArgs,
  type DbCtx,
  type NewEntity,
  type SqlOp,
  type VecTargetKind,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  branchSnapshot,
  cloneBranch,
  seedCopyFixture,
  type TestDb,
} from '@/lib/db/__tests__/two-branch'
import { plantVec } from '@/lib/db/__tests__/vec-fixtures'
import { logger } from '@/lib/diagnostics'
import { isStorySwapPending } from '@/lib/embedder-swap'
import {
  currentStoryStore,
  entriesStore,
  generationStore,
  resetAllStores,
  storiesStore,
  undoRedoStore,
  type RunState,
} from '@/lib/stores'

import { BRANCH_SCOPED, deleteStory } from './delete-story'
import {
  checkStoryDuplicate,
  DUPLICATE_REFUSAL,
  duplicateStory,
  type DuplicateBranch,
  type DuplicateRefusalCode,
  type DuplicateStoryResult,
} from './duplicate-story'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { __resetBranchWriteLocks } from '../delta/branch-write-lock'
import { __redoGroupForTest } from '../delta/redo'
import { redoLastAction, undoLastAction } from '../story-entries/undo'

// In-flight = the embedder's in-process lock, taken only by a running swap (read's case:
// lib/embedder-swap/app-deps.test.ts). `pending` also reads pending to the synchronous check.
const swap = vi.hoisted(() => ({
  inFlight: new Set<string>(),
  pending: new Set<string>(),
}))

// The copier's real ops; `afterCall` runs once each call's own reads have resolved, given the
// call's 1-based count, so a test can admit a swap or a run during the action's last await.
const copier = vi.hoisted(() => ({
  calls: 0,
  afterCall: null as ((call: number) => void) | null,
}))

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<{
    branchCopyOps: (db: DbCtx['db'], args: BranchCopyArgs) => Promise<SqlOp[]>
  }>()
  return {
    ...actual,
    branchCopyOps: async (db: DbCtx['db'], args: BranchCopyArgs) => {
      const ops = await actual.branchCopyOps(db, args)
      copier.calls += 1
      copier.afterCall?.(copier.calls)
      return ops
    },
  }
})

// The unfinished-run read's call-through, `afterCall` as the copier's.
const unfinishedRead = vi.hoisted(() => ({
  calls: 0,
  afterCall: null as ((call: number) => void) | null,
}))

vi.mock('../delta/unfinished-runs', async (importOriginal) => {
  const actual = await importOriginal<{
    readUnfinishedRuns: (branchId: string, ctx: Pick<DbCtx, 'db'>) => Promise<unknown[]>
  }>()
  return {
    ...actual,
    readUnfinishedRuns: async (branchId: string, ctx: Pick<DbCtx, 'db'>) => {
      const runs = await actual.readUnfinishedRuns(branchId, ctx)
      unfinishedRead.calls += 1
      unfinishedRead.afterCall?.(unfinishedRead.calls)
      return runs
    },
  }
})

vi.mock('@/lib/embedder-swap', async (importOriginal) => {
  const actual = await importOriginal<{
    isStorySwapPending: (storyId: string) => boolean
    readStorySwapPending: (db: DbCtx['db'], storyId: string) => Promise<boolean>
  }>()
  return {
    ...actual,
    readStorySwapPending: async (db: DbCtx['db'], storyId: string) =>
      swap.inFlight.has(storyId) || actual.readStorySwapPending(db, storyId),
    isStorySwapPending: (storyId: string) =>
      swap.pending.has(storyId) || actual.isStorySwapPending(storyId),
  }
})

const STORY = 's_two'
const A = 'br_a'
const B = 'br_b'
const OTHER_STORY = 's_other'
const OTHER_BRANCH = 'br_other'
const AT = 1_767_300_000_000

const DEFINITION = storyDefinitionSchema.parse({
  mode: 'creative',
  narration: 'third',
  genre: { label: 'Western', promptBody: '' },
  tone: { label: 'Spare', promptBody: '' },
  setting: '',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
})

let t: TestDb
let posted: Mock<DbCtx['runInTransaction']>
let ctx: DbCtx

beforeEach(async () => {
  resetAllStores()
  swap.inFlight.clear()
  swap.pending.clear()
  copier.calls = 0
  copier.afterCall = null
  unfinishedRead.calls = 0
  unfinishedRead.afterCall = null
  t = await createTestDb()
  posted = vi.fn(t.runInTransaction)
  ctx = { db: t.db, runInTransaction: posted }
  await seedTwoStories()
})

afterEach(() => {
  __resetBranchWriteLocks()
  resetAllStores()
  vi.restoreAllMocks()
})

/** `s_two` (active): A current, B, A's copy and child, ids shared; `s_other`: one empty branch. */
async function seedTwoStories(): Promise<void> {
  await seedCopyFixture(t)
  cloneBranch(t.sqlite, A, B)
  t.sqlite
    .prepare("UPDATE stories SET status = 'active', current_branch_id = ? WHERE id = ?")
    .run(A, STORY)
  await t.db.insert(stories).values({
    id: OTHER_STORY,
    title: 'Elsewhere',
    status: 'active',
    createdAt: AT,
    updatedAt: AT,
    currentBranchId: OTHER_BRANCH,
  })
  await t.db
    .insert(branches)
    .values({ id: OTHER_BRANCH, storyId: OTHER_STORY, name: 'main', createdAt: AT })
}

const check = (branch: DuplicateBranch, storyId: string = STORY) =>
  checkStoryDuplicate(storyId, branch, { db: t.db })

/** Every table's rows as stored; vec0's shadow tables left out, its family tables read whole. */
function everyRow(sqlite: DatabaseSync): Record<string, unknown[]> {
  const names = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[]
  const rows: Record<string, unknown[]> = {}
  for (const { name } of names) {
    if (isVecFamilyTable(name))
      rows[name] = sqlite
        .prepare(
          `SELECT pk, branch_id, model_id, id, source_hash, hex(embedding) AS embedding FROM ${name} ORDER BY pk`,
        )
        .all()
    else if (!name.includes('_vec_') && !name.startsWith('sqlite_'))
      rows[name] = sqlite.prepare(`SELECT * FROM "${name}"`).all()
  }
  return rows
}

async function expectRefused(
  branch: DuplicateBranch,
  code: DuplicateRefusalCode,
  storyId: string = STORY,
): Promise<void> {
  const before = everyRow(t.sqlite)
  expect(await check(branch, storyId)).toEqual({ status: 'rejected', code })
  expect(everyRow(t.sqlite)).toEqual(before)
}

// No-gate, like a pass: canon refuses any registered run, not only one holding the gate.
function registerRun(run: { storyId: string | null; branchId: string }): void {
  generationStore.startRun({
    runId: 'run_dup_test',
    kind: 'periodic-classifier',
    gateBehavior: 'no-gate',
    interruptible: null,
    beforeTurn: false,
    actionId: 'act_dup_test',
    ...run,
    abortController: new AbortController(),
    currentPhase: 'classify',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  } satisfies RunState)
}

function setClassifierState(branchId: string, state: 'idle' | 'running'): void {
  t.sqlite
    .prepare('UPDATE branches SET classifier_status = ? WHERE id = ?')
    .run(
      JSON.stringify({ state, lastSuccessAt: null, lastError: null, processedThrough: 3 }),
      branchId,
    )
}

async function openRunRow(branchId: string): Promise<void> {
  await t.db.insert(pipelineRuns).values({
    runId: `run_open_${branchId}`,
    kind: 'per-turn',
    actionId: `act_open_${branchId}`,
    storyId: STORY,
    branchId,
    startedAt: AT,
  })
}

// The engine's marker, as markSwapPending writes it for E2E.
function markSwap(storyId: string): void {
  t.sqlite
    .prepare('UPDATE stories SET settings = ? WHERE id = ?')
    .run(JSON.stringify({ embedding_swap_target: 'other-embedder' }), storyId)
}

function openStory(storyId: string, branchId: string): void {
  currentStoryStore.set({
    storyId,
    branchId,
    definition: DEFINITION,
    settings: STORY_SETTINGS_DEFAULTS,
  })
}

describe('checkStoryDuplicate', () => {
  it.each<DuplicateBranch>([{ branchId: A }, { branchId: B }, 'all'])(
    'passes a live story copying %j',
    async (branch) => {
      expect(await check(branch)).toEqual({ status: 'ok' })
    },
  )

  it('passes an archived story', async () => {
    t.sqlite.prepare("UPDATE stories SET status = 'archived' WHERE id = ?").run(STORY)
    expect(await check('all')).toEqual({ status: 'ok' })
  })

  it('refuses missing for a story with no row', async () => {
    await expectRefused('all', DUPLICATE_REFUSAL.missing, 's_nowhere')
  })

  it.each<DuplicateBranch>([{ branchId: OTHER_BRANCH }, { branchId: 'br_nowhere' }])(
    'refuses missing for %j, a branch not on the story',
    async (branch) => {
      await expectRefused(branch, DUPLICATE_REFUSAL.missing)
    },
  )

  it('refuses missing for all branches of a story holding none', async () => {
    await t.db
      .insert(stories)
      .values({ id: 's_bare', title: 'Bare', status: 'active', createdAt: AT, updatedAt: AT })
    await expectRefused('all', DUPLICATE_REFUSAL.missing, 's_bare')
  })

  it('refuses a draft', async () => {
    t.sqlite.prepare("UPDATE stories SET status = 'draft' WHERE id = ?").run(STORY)
    await expectRefused('all', DUPLICATE_REFUSAL.draft)
  })

  it.each([
    ['another story open', () => openStory(OTHER_STORY, OTHER_BRANCH)],
    ['no story open', () => {}],
  ] as const)('refuses a swap marker stored on the story, with %s', async (_, open) => {
    markSwap(STORY)
    open()
    // Not vacuous: the open story's check can't see this story's marker.
    expect(isStorySwapPending(STORY)).toBe(false)
    await expectRefused({ branchId: A }, DUPLICATE_REFUSAL.swapPending)
  })

  it('refuses a swap in flight before any marker is stored', async () => {
    swap.inFlight.add(STORY)
    await expectRefused({ branchId: A }, DUPLICATE_REFUSAL.swapPending)
  })

  it("passes while another story's swap is pending", async () => {
    markSwap(OTHER_STORY)
    swap.inFlight.add(OTHER_STORY)
    expect(await check('all')).toEqual({ status: 'ok' })
  })

  it.each([
    ['its story', { storyId: STORY, branchId: 'br_gone' }, { branchId: B }],
    ['its branch alone', { storyId: null, branchId: B }, { branchId: A }],
  ] as const)('refuses a registered run, matched by %s', async (_, run, branch) => {
    registerRun(run)
    await expectRefused(branch, DUPLICATE_REFUSAL.runRegistered)
  })

  it("passes while another story's run is registered", async () => {
    registerRun({ storyId: OTHER_STORY, branchId: OTHER_BRANCH })
    expect(await check('all')).toEqual({ status: 'ok' })
  })

  it('refuses a copied branch whose classifier is running, judging only the copied ones', async () => {
    setClassifierState(B, 'running')
    await expectRefused({ branchId: B }, DUPLICATE_REFUSAL.branchHeld)
    await expectRefused('all', DUPLICATE_REFUSAL.branchHeld)
    expect(await check({ branchId: A })).toEqual({ status: 'ok' })
  })

  it("parses no classifier status off a branch it doesn't copy", async () => {
    t.sqlite.prepare('UPDATE branches SET classifier_status = ? WHERE id = ?').run('{not json', B)
    expect(await check({ branchId: A })).toEqual({ status: 'ok' })
    const result = await duplicateStory(
      { storyId: STORY, title: 'Copy', branch: { branchId: A } },
      ctx,
    )
    expect(result).toEqual({ status: 'duplicated', storyId: expect.any(String) })
    // A copied branch's malformed status still fails the check rather than passing unread.
    const failure = (branch: DuplicateBranch) =>
      check(branch).then(
        () => 'passed',
        (error: Error) => (error.cause as Error).message,
      )
    expect(await failure({ branchId: B })).toBe('malformed JSON')
    expect(await failure('all')).toBe('malformed JSON')
  })

  it('refuses a copied branch with an unfinished run row, judging only the copied ones', async () => {
    // Not vacuous: A's finished row is a run row too, and must not refuse.
    const finished = t.sqlite
      .prepare(
        'SELECT count(*) AS n FROM pipeline_runs WHERE branch_id = ? AND finished_at IS NOT NULL',
      )
      .get(A) as { n: number }
    expect(finished.n).toBe(1)
    await openRunRow(B)
    await expectRefused({ branchId: B }, DUPLICATE_REFUSAL.unfinishedRun)
    await expectRefused('all', DUPLICATE_REFUSAL.unfinishedRun)
    expect(await check({ branchId: A })).toEqual({ status: 'ok' })
  })

  it('reports the first refusal in canon order', async () => {
    t.sqlite.prepare("UPDATE stories SET status = 'draft' WHERE id = ?").run(STORY)
    markSwap(STORY)
    registerRun({ storyId: STORY, branchId: A })
    setClassifierState(B, 'running')
    await openRunRow(B)
    const first = async () => {
      const checked = await check({ branchId: B })
      return checked.status === 'rejected' ? checked.code : checked.status
    }

    expect(await first()).toBe(DUPLICATE_REFUSAL.draft)
    t.sqlite.prepare("UPDATE stories SET status = 'active' WHERE id = ?").run(STORY)
    expect(await first()).toBe(DUPLICATE_REFUSAL.swapPending)
    t.sqlite.prepare('UPDATE stories SET settings = NULL WHERE id = ?').run(STORY)
    expect(await first()).toBe(DUPLICATE_REFUSAL.runRegistered)
    generationStore.__reset()
    expect(await first()).toBe(DUPLICATE_REFUSAL.branchHeld)
    setClassifierState(B, 'idle')
    expect(await first()).toBe(DUPLICATE_REFUSAL.unfinishedRun)
  })
})

// Sorts between A and B: under the fixture's created_at tie only the parent walk puts B first.
const C = 'br_a_c'
const B_NAME = 'The ford at night'
const C_NAME = 'The far bank'
const TITLE = 'The Ford, again'
// Odd spacing and non-ASCII: only a copy that never re-serializes keeps them.
const B_STATUS =
  '{"state":"idle",  "processedThrough":3,"lastSuccessAt":1767225600009,"lastError":null}'
const DEFINITION_TEXT =
  '{ "mode":"creative", "narration":"third","genre":{"label":"Western","promptBody":""},"tone":{"label":"Spare","promptBody":""},"setting":"The Harrow ford – ž","calendarSystemId":"gregorian","worldTimeOrigin":{"year":0} }'
const SETTINGS_TEXT = '{ "chapterTokenThreshold" : 24000,\n  "note": "日本" }'
const TAGS_TEXT = '[ "river",  "drover" ]'

// The manifest's Duplicate copies, in the copier's order (lib/db/branch-copy/copier.test.ts).
const DUPLICATE_TABLES = [
  'story_entries',
  'entities',
  'character_relationships',
  'lore',
  'threads',
  'happenings',
  'happening_involvements',
  'happening_awareness',
  'chapters',
  'branch_era_flips',
  'translations',
  'entry_assets',
  'deltas',
  'reversal_journals',
] as const

type SqlRow = Record<string, unknown>
type BranchSqlRow = {
  id: string
  story_id: string
  parent_branch_id: string | null
  fork_entry_id: string | null
  name: string
  created_at: number
  classifier_status: string | null
}
type VectorSqlRow = {
  pk: string
  model_id: string
  id: string
  source_hash: string
  embedding: string
}
type CopiedStory = { storyId: string; branches: BranchSqlRow[] }

function storyRow(storyId: string): SqlRow {
  const row = t.sqlite.prepare('SELECT * FROM stories WHERE id = ?').get(storyId) as
    | SqlRow
    | undefined
  if (!row) throw new Error(`no stories row ${storyId}`)
  return row
}

function branchRow(branchId: string): BranchSqlRow {
  const row = t.sqlite.prepare('SELECT * FROM branches WHERE id = ?').get(branchId) as
    | BranchSqlRow
    | undefined
  if (!row) throw new Error(`no branches row ${branchId}`)
  return row
}

function copyOf(result: DuplicateStoryResult): CopiedStory {
  if (result.status !== 'duplicated')
    throw new Error(`expected a copy, got ${JSON.stringify(result)}`)
  const rows = t.sqlite
    .prepare('SELECT * FROM branches WHERE story_id = ? ORDER BY name')
    .all(result.storyId) as BranchSqlRow[]
  return { storyId: result.storyId, branches: rows }
}

function named(copy: CopiedStory, name: string): BranchSqlRow {
  const row = copy.branches.find((branch) => branch.name === name)
  if (!row) throw new Error(`the copy holds no branch named ${name}`)
  return row
}

// A branch's rows as stored (JSON as its text), branch_id dropped, in a stable order.
function rowsOf(table: string, branchId: string): SqlRow[] {
  const rows = t.sqlite
    .prepare(`SELECT * FROM "${table}" WHERE branch_id = ?`)
    .all(branchId) as SqlRow[]
  return rows
    .map(({ branch_id: _branch, ...row }) => ({ key: JSON.stringify(row), row }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ row }) => row)
}

function entryIdsOf(branchId: string): string[] {
  const rows = t.sqlite
    .prepare('SELECT id FROM story_entries WHERE branch_id = ? ORDER BY position')
    .all(branchId) as { id: string }[]
  return rows.map(({ id }) => id)
}

// A's non-system entries by position: the opening, the user's turn, the reply.
function forkPoints(): string[] {
  const rows = t.sqlite
    .prepare(
      "SELECT id FROM story_entries WHERE branch_id = ? AND kind <> 'system' ORDER BY position",
    )
    .all(A) as { id: string }[]
  return rows.map(({ id }) => id)
}

function firstId(table: string, branchId: string): string {
  const row = t.sqlite
    .prepare(`SELECT id FROM "${table}" WHERE branch_id = ? ORDER BY id LIMIT 1`)
    .get(branchId) as { id: string } | undefined
  if (!row) throw new Error(`no ${table} row on ${branchId}`)
  return row.id
}

function countWhere(table: string, where: string, ...params: SQLInputValue[]): number {
  const row = t.sqlite
    .prepare(`SELECT count(*) AS n FROM "${table}" WHERE ${where}`)
    .get(...params) as { n: number }
  return row.n
}

/** Each family table's rows on the branch, embeddings as hex; a table holding none is left out. */
function vectorsOn(branchId: string): Record<string, VectorSqlRow[]> {
  const names = t.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[]
  const out: Record<string, VectorSqlRow[]> = {}
  for (const { name } of names) {
    if (!isVecFamilyTable(name)) continue
    const rows = t.sqlite
      .prepare(
        `SELECT pk, model_id, id, source_hash, hex(embedding) AS embedding FROM ${name} WHERE branch_id = ? ORDER BY pk`,
      )
      .all(branchId) as VectorSqlRow[]
    if (rows.length > 0) out[name] = rows
  }
  return out
}

function plantVector(kind: VecTargetKind, id: string, branchId: string, dim: number): void {
  const vector = new Float32Array(dim)
  vector[0] = 1
  plantVec(t.sqlite, {
    kind,
    id,
    branchId,
    modelId: `model-${dim}`,
    dim,
    sourceHash: sourceHash(id),
    vector: packFloat32(vector),
  })
}

// Every branch id a row names, in each table with a branch_id column, vec families included.
function branchIdsHeld(): string[] {
  const names = t.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[]
  const held = new Set<string>()
  for (const { name } of names) {
    const scoped =
      isVecFamilyTable(name) ||
      (!name.includes('_vec_') &&
        t.sqlite
          .prepare("SELECT 1 FROM pragma_table_info(?) WHERE name = 'branch_id'")
          .get(name) !== undefined)
    if (!scoped) continue
    const rows = t.sqlite.prepare(`SELECT DISTINCT branch_id FROM "${name}"`).all() as {
      branch_id: string | null
    }[]
    for (const { branch_id: id } of rows) if (id != null) held.add(id)
  }
  return [...held].sort()
}

// A branch delete's batch, built here so the race needs no delete action: the branch's rows, its
// vectors, its children re-parented onto its parent, then its row.
async function branchDeleteOps(branchId: string): Promise<SqlOp[]> {
  const { parent } = t.sqlite
    .prepare('SELECT parent_branch_id AS parent FROM branches WHERE id = ?')
    .get(branchId) as { parent: string | null }
  return [
    ...BRANCH_SCOPED.map((table) => t.db.delete(table).where(eq(table.branchId, branchId)).toSQL()),
    ...deleteBranchVecOps(await listVecFamilyTables(t.db), [branchId]),
    t.db
      .update(branches)
      .set({ parentBranchId: parent })
      .where(eq(branches.parentBranchId, branchId))
      .toSQL(),
    t.db.delete(branches).where(eq(branches.id, branchId)).toSQL(),
  ]
}

/** What a duplicate must leave as it was: the source's rows, vectors, run rows and sessions. */
function sourceState() {
  return {
    story: storyRow(STORY),
    branches: t.sqlite.prepare('SELECT * FROM branches WHERE story_id = ? ORDER BY id').all(STORY),
    rows: { [A]: branchSnapshot(t.sqlite, A), [B]: branchSnapshot(t.sqlite, B) },
    vectors: { [A]: vectorsOn(A), [B]: vectorsOn(B) },
    runs: t.sqlite.prepare('SELECT * FROM pipeline_runs ORDER BY run_id').all(),
    sessions: t.sqlite.prepare('SELECT * FROM wizard_sessions ORDER BY id').all(),
  }
}

/**
 * Source archived and favorited, JSON stored as text no serializer writes; B a fork of A at the
 * reply with vectors in two dims; a run row on B and a wizard session, neither of which copies.
 */
async function prepareSource(): Promise<void> {
  const [, , reply] = forkPoints()
  const { id: assetId } = t.sqlite.prepare('SELECT id FROM assets').get() as { id: string }
  t.sqlite
    .prepare(
      `UPDATE stories SET status = 'archived', favorite = 1, description = ?, tags = ?,
       cover_asset_id = ?, accent_color = ?, definition = ?, settings = ?, last_opened_at = ?
       WHERE id = ?`,
    )
    .run(
      "A drover's crossing.",
      TAGS_TEXT,
      assetId,
      '#3a7d5c',
      DEFINITION_TEXT,
      SETTINGS_TEXT,
      AT + 50,
      STORY,
    )
  t.sqlite
    .prepare('UPDATE branches SET name = ?, fork_entry_id = ?, classifier_status = ? WHERE id = ?')
    .run(B_NAME, reply, B_STATUS, B)
  for (const dim of [4, 8]) for (const ddl of ensureVecTablesSql(dim)) t.sqlite.exec(ddl)
  const character = firstId('entities', B)
  for (const dim of [4, 8]) plantVector('entity', character, B, dim)
  plantVector('lore', firstId('lore', B), B, 4)
  plantVector('entity', character, A, 4)
  await t.db.insert(pipelineRuns).values({
    runId: 'run_b_done',
    kind: 'per-turn',
    actionId: 'act_b_done',
    storyId: STORY,
    branchId: B,
    startedAt: AT,
    finishedAt: AT + 1,
    outcome: 'completed',
  })
  await t.db
    .insert(wizardSessions)
    .values({ id: STORY, storyId: STORY, state: emptyWorkingState(), updatedAt: AT })
}

/** A → B → C, tied on created_at, C's id sorting between A's and B's; B current. */
function seedTree(): void {
  cloneBranch(t.sqlite, B, C)
  const [, turn, reply] = forkPoints()
  const fork = t.sqlite.prepare('UPDATE branches SET name = ?, fork_entry_id = ? WHERE id = ?')
  fork.run(B_NAME, reply, B)
  fork.run(C_NAME, turn, C)
  t.sqlite.prepare('UPDATE stories SET current_branch_id = ? WHERE id = ?').run(B, STORY)
}

describe('duplicateStory', () => {
  async function duplicateB() {
    await prepareSource()
    undoRedoStore.pushRedoGroup(__redoGroupForTest(B))
    const before = sourceState()
    const redoTop = undoRedoStore.peekRedoGroup(B)
    const startedAt = Date.now()
    const result = await duplicateStory(
      { storyId: STORY, title: TITLE, branch: { branchId: B } },
      ctx,
    )
    const endedAt = Date.now()
    const copy = copyOf(result)
    expect(copy.branches).toHaveLength(1)
    const [{ id: copyBranchId }] = copy.branches
    return { before, redoTop, startedAt, endedAt, copy, copyBranchId }
  }

  async function expectRefusedWritingNothing(
    input: { title: string; branch: DuplicateBranch },
    code: DuplicateRefusalCode,
  ): Promise<void> {
    const before = everyRow(t.sqlite)
    expect(await duplicateStory({ storyId: STORY, ...input }, ctx)).toEqual({
      status: 'rejected',
      code,
    })
    expect(posted).not.toHaveBeenCalled()
    expect(everyRow(t.sqlite)).toEqual(before)
  }

  it('mints a fresh story_ and br_ id and copies every row of the branch under the new one', async () => {
    const { copy, copyBranchId } = await duplicateB()

    expect(copy.storyId).toMatch(/^story_[0-9a-f-]{36}$/)
    expect(copyBranchId).toMatch(/^br_[0-9a-f-]{36}$/)
    for (const table of DUPLICATE_TABLES) {
      const source = rowsOf(table, B)
      expect(source.length, table).toBeGreaterThan(0)
      expect(rowsOf(table, copyBranchId), table).toEqual(source)
    }
    // A trailing failure card keeps its Retry in the copy.
    expect(rowsOf('story_entries', copyBranchId).some((row) => row.kind === 'system')).toBe(true)
  })

  it("writes the copy's stories row: the title, active, not favorite, never opened, the copy current", async () => {
    const { copy, copyBranchId, startedAt, endedAt } = await duplicateB()

    const { created_at: createdAt, updated_at: updatedAt, ...row } = storyRow(copy.storyId)
    const { created_at: _created, updated_at: _updated, ...source } = storyRow(STORY)
    // Not vacuous: the source differs on each field the copy sets, and holds its JSON as typed.
    expect(source).toMatchObject({
      status: 'archived',
      favorite: 1,
      last_opened_at: AT + 50,
      current_branch_id: A,
      definition: DEFINITION_TEXT,
      settings: SETTINGS_TEXT,
      tags: TAGS_TEXT,
    })
    expect(row).toEqual({
      ...source,
      id: copy.storyId,
      title: TITLE,
      status: 'active',
      favorite: 0,
      last_opened_at: null,
      current_branch_id: copyBranchId,
    })
    expect(createdAt).toBeGreaterThanOrEqual(startedAt)
    expect(createdAt).toBeLessThanOrEqual(endedAt)
    expect(updatedAt).toBe(createdAt)
  })

  it("copies the branch row's name, created_at and classifier_status verbatim, as the copy's root", async () => {
    const { copy, copyBranchId } = await duplicateB()

    const source = branchRow(B)
    expect(source).toMatchObject({ parent_branch_id: A, classifier_status: B_STATUS })
    expect(source.fork_entry_id).not.toBeNull()
    expect(copy.branches).toEqual([
      {
        ...source,
        id: copyBranchId,
        story_id: copy.storyId,
        parent_branch_id: null,
        fork_entry_id: null,
      },
    ])
  })

  it('copies the branch vectors in every family, each pk built for the new branch', async () => {
    const { copyBranchId } = await duplicateB()

    const source = vectorsOn(B)
    expect(Object.keys(source).sort()).toEqual(['entities_vec_4', 'entities_vec_8', 'lore_vec_4'])
    const expected = Object.fromEntries(
      Object.entries(source).map(([table, rows]) => [
        table,
        rows.map((row) => ({ ...row, pk: `${copyBranchId}:${row.id}:${row.model_id}` })),
      ]),
    )
    expect(vectorsOn(copyBranchId)).toEqual(expected)
  })

  it('copies no probe capture, run row or wizard session', async () => {
    const { copy, copyBranchId } = await duplicateB()

    expect(countWhere('probe_captures', 'branch_id = ?', B)).toBeGreaterThan(0)
    expect(countWhere('probe_captures', 'branch_id = ?', copyBranchId)).toBe(0)
    expect(countWhere('pipeline_runs', 'branch_id = ?', B)).toBe(1)
    expect(
      countWhere('pipeline_runs', 'branch_id = ? OR story_id = ?', copyBranchId, copy.storyId),
    ).toBe(0)
    expect(countWhere('wizard_sessions', 'id = ? OR story_id = ?', STORY, STORY)).toBe(1)
    expect(
      countWhere('wizard_sessions', 'id = ? OR story_id = ?', copy.storyId, copy.storyId),
    ).toBe(0)
  })

  it("leaves the source's rows, branches, vectors and redo stack as they were", async () => {
    const { before, redoTop, copyBranchId } = await duplicateB()

    expect(sourceState()).toEqual(before)
    expect(redoTop).toBeDefined()
    expect(undoRedoStore.peekRedoGroup(B)).toBe(redoTop)
    expect(undoRedoStore.__branches()).toEqual([B])
    expect(undoRedoStore.hasRedo(copyBranchId)).toBe(false)
  })

  it('logs the batch it posted and re-reads the stories store', async () => {
    const debug = vi.spyOn(logger, 'debug')
    const { copy } = await duplicateB()

    expect(posted).toHaveBeenCalledTimes(1)
    const [[batch]] = posted.mock.calls
    expect(debug).toHaveBeenCalledWith('action_layer.story_duplicated', {
      storyId: STORY,
      newStoryId: copy.storyId,
      branches: 1,
      ops: batch.length,
      durationMs: expect.any(Number),
    })
    expect(storiesStore.getStories().rows.map(({ id }) => id)).toContain(copy.storyId)
  })

  it('stores the title trimmed', async () => {
    const result = await duplicateStory(
      { storyId: STORY, title: '  The Ford, again \n', branch: { branchId: A } },
      ctx,
    )
    expect(storyRow(copyOf(result).storyId).title).toBe('The Ford, again')
  })

  it.each(['', '   \n'])('refuses the empty title %j, writing nothing', async (title) => {
    await expectRefusedWritingNothing({ title, branch: 'all' }, DUPLICATE_REFUSAL.empty)
  })

  it("refuses at the action's own check, writing nothing", async () => {
    t.sqlite.prepare("UPDATE stories SET status = 'draft' WHERE id = ?").run(STORY)
    await expectRefusedWritingNothing({ title: TITLE, branch: 'all' }, DUPLICATE_REFUSAL.draft)
  })

  // A and B copy, so the second copier call is the action's last await before the post.
  it('refuses a swap admitted during its last read, read with no await before the post', async () => {
    copier.afterCall = (call) => {
      if (call === 2) swap.pending.add(STORY)
    }
    await expectRefusedWritingNothing(
      { title: TITLE, branch: 'all' },
      DUPLICATE_REFUSAL.swapPending,
    )
    expect(copier.calls).toBe(2)
  })

  /** A full duplicate where `write` lands at `hook`'s call `call`: refused, every table as written. */
  async function expectRefusedAfterWrite(
    hook: { afterCall: ((call: number) => void) | null },
    call: number,
    write: () => void,
    code: DuplicateRefusalCode,
  ): Promise<void> {
    let written: Record<string, unknown[]> = {}
    hook.afterCall = (n) => {
      if (n !== call) return
      write()
      written = everyRow(t.sqlite)
    }

    expect(await duplicateStory({ storyId: STORY, title: TITLE, branch: 'all' }, ctx)).toEqual({
      status: 'rejected',
      code,
    })

    expect(posted).not.toHaveBeenCalled()
    expect(Object.keys(written).length).toBeGreaterThan(0)
    expect(everyRow(t.sqlite)).toEqual(written)
  }

  it('refuses a swap marker stored during its last copier read, with no swap in flight', async () => {
    // Not vacuous: no story is open, so only the stored marker can refuse.
    expect(currentStoryStore.getCurrentStory()).toBeNull()
    await expectRefusedAfterWrite(copier, 2, () => markSwap(STORY), DUPLICATE_REFUSAL.swapPending)
    expect(copier.calls).toBe(2)
  })

  it('refuses an unfinished run row written on a copied branch during its last copier read', async () => {
    // Synchronous, so the row stands before the action's next read.
    const openRow = () =>
      t.sqlite
        .prepare(
          'INSERT INTO pipeline_runs (run_id, kind, action_id, story_id, branch_id, started_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('run_open_b', 'per-turn', 'act_open_b', STORY, B, AT)
    await expectRefusedAfterWrite(copier, 2, openRow, DUPLICATE_REFUSAL.unfinishedRun)
    expect(copier.calls).toBe(2)
  })

  it('refuses a copied branch whose classifier starts running during its last copier read', async () => {
    await expectRefusedAfterWrite(
      copier,
      2,
      () => setClassifierState(B, 'running'),
      DUPLICATE_REFUSAL.branchHeld,
    )
    expect(copier.calls).toBe(2)
  })

  // A and B, read by the check and again before the post: the fourth read is the last await.
  it('refuses a swap marker stored during its last unfinished-run read', async () => {
    await expectRefusedAfterWrite(
      unfinishedRead,
      4,
      () => markSwap(STORY),
      DUPLICATE_REFUSAL.swapPending,
    )
    expect(unfinishedRead.calls).toBe(4)
  })

  it('refuses a run registered during its last read, read with no await before the post', async () => {
    copier.afterCall = (call) => {
      if (call === 2) registerRun({ storyId: STORY, branchId: A })
    }
    await expectRefusedWritingNothing(
      { title: TITLE, branch: 'all' },
      DUPLICATE_REFUSAL.runRegistered,
    )
    expect(copier.calls).toBe(2)
  })

  it("copies one branch while the story's other branch holds an unfinished run, carrying no run row", async () => {
    await openRunRow(A)

    const copy = copyOf(
      await duplicateStory({ storyId: STORY, title: TITLE, branch: { branchId: B } }, ctx),
    )

    const [{ id: copyBranchId }] = copy.branches
    expect(
      countWhere('pipeline_runs', 'branch_id = ? OR story_id = ?', copyBranchId, copy.storyId),
    ).toBe(0)
    expect(countWhere('pipeline_runs', 'branch_id = ? AND finished_at IS NULL', A)).toBe(1)
  })

  it('copies every branch of a three-level tree, parents first, each parent remapped', async () => {
    seedTree()
    const [sourceA, sourceB, sourceC] = [A, B, C].map(branchRow)
    // Not vacuous: on created_at, then id, C would come before its parent B.
    expect(new Set([sourceA, sourceB, sourceC].map((row) => row.created_at)).size).toBe(1)
    expect([A, B, C].sort()).toEqual([A, C, B])

    const copy = copyOf(await duplicateStory({ storyId: STORY, title: TITLE, branch: 'all' }, ctx))

    expect(copy.branches).toHaveLength(3)
    const copyA = named(copy, sourceA.name)
    const copyB = named(copy, B_NAME)
    const copyC = named(copy, C_NAME)
    for (const { id } of [copyA, copyB, copyC]) {
      expect(id).toMatch(/^br_[0-9a-f-]{36}$/)
      expect([A, B, C]).not.toContain(id)
    }
    expect(copyA).toEqual({ ...sourceA, id: copyA.id, story_id: copy.storyId })
    expect(copyB).toEqual({
      ...sourceB,
      id: copyB.id,
      story_id: copy.storyId,
      parent_branch_id: copyA.id,
    })
    expect(copyC).toEqual({
      ...sourceC,
      id: copyC.id,
      story_id: copy.storyId,
      parent_branch_id: copyB.id,
    })
    expect(sourceB.fork_entry_id).not.toBeNull()
    expect(sourceC.fork_entry_id).not.toBeNull()
    for (const [source, copied] of [
      [A, copyA],
      [B, copyB],
      [C, copyC],
    ] as const)
      expect(entryIdsOf(copied.id)).toEqual(entryIdsOf(source))
    expect(storyRow(copy.storyId).current_branch_id).toBe(copyB.id)
  })

  it("makes the copy's root current when the source's pointer names none of its branches", async () => {
    seedTree()
    t.sqlite.prepare('UPDATE stories SET current_branch_id = ? WHERE id = ?').run('br_gone', STORY)

    const copy = copyOf(await duplicateStory({ storyId: STORY, title: TITLE, branch: 'all' }, ctx))

    expect(storyRow(copy.storyId).current_branch_id).toBe(named(copy, 'main').id)
  })

  it("picks the copy's current branch over more branches than an SQL function takes arguments", async () => {
    // node:sqlite caps a function at 1000 arguments; one per copied branch would pass it.
    const insert = t.sqlite.prepare(
      'INSERT INTO branches (id, story_id, parent_branch_id, name, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    for (let i = 0; i < 1000; i += 1)
      insert.run(`br_many_${i}`, OTHER_STORY, OTHER_BRANCH, `fork ${i}`, AT + 1)
    t.sqlite
      .prepare('UPDATE stories SET current_branch_id = ? WHERE id = ?')
      .run('br_many_500', OTHER_STORY)

    const copy = copyOf(
      await duplicateStory({ storyId: OTHER_STORY, title: TITLE, branch: 'all' }, ctx),
    )

    expect(copy.branches).toHaveLength(1001)
    expect(storyRow(copy.storyId).current_branch_id).toBe(named(copy, 'fork 500').id)
  })

  it('throws on a cycle in the parent links, writing nothing', async () => {
    seedTree()
    t.sqlite.prepare('UPDATE branches SET parent_branch_id = ? WHERE id = ?').run(C, A)
    const before = everyRow(t.sqlite)

    await expect(
      duplicateStory({ storyId: STORY, title: TITLE, branch: 'all' }, ctx),
    ).rejects.toThrow('the branches form a cycle')

    expect(posted).not.toHaveBeenCalled()
    expect(everyRow(t.sqlite)).toEqual(before)
  })

  it('copies the tree without a leaf deleted between its reads and its batch', async () => {
    seedTree()
    for (const ddl of ensureVecTablesSql(4)) t.sqlite.exec(ddl)
    plantVector('entity', firstId('entities', C), C, 4)
    const racing: DbCtx = {
      db: t.db,
      runInTransaction: async (ops) => {
        await t.runInTransaction(await branchDeleteOps(C))
        await t.runInTransaction(ops)
      },
    }

    const copy = copyOf(
      await duplicateStory({ storyId: STORY, title: TITLE, branch: 'all' }, racing),
    )

    expect(copy.branches.map(({ name }) => name).sort()).toEqual([B_NAME, 'main'].sort())
    expect(named(copy, B_NAME).parent_branch_id).toBe(named(copy, 'main').id)
    expect(storyRow(copy.storyId).current_branch_id).toBe(named(copy, B_NAME).id)
    // Nothing names the gone branch or the copy minted for it: every id a row holds is a branch.
    const live = (t.sqlite.prepare('SELECT id FROM branches').all() as { id: string }[]).map(
      ({ id }) => id,
    )
    expect(live).not.toContain(C)
    expect(branchIdsHeld().filter((id) => !live.includes(id))).toEqual([])
  })

  it('fails the batch, writing nothing, when a parent goes between its reads and its batch', async () => {
    seedTree()
    let afterDelete: Record<string, unknown[]> = {}
    const racing: DbCtx = {
      db: t.db,
      runInTransaction: async (ops) => {
        await t.runInTransaction(await branchDeleteOps(B))
        afterDelete = everyRow(t.sqlite)
        await t.runInTransaction(ops)
      },
    }

    await expect(
      duplicateStory({ storyId: STORY, title: TITLE, branch: 'all' }, racing),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/)

    expect(Object.keys(afterDelete).length).toBeGreaterThan(0)
    expect(everyRow(t.sqlite)).toEqual(afterDelete)
  })

  /** A ctx whose batch runs after `write`, which stands in for one landing after the reads. */
  function racing(write: () => Promise<void>) {
    let afterWrite: Record<string, unknown[]> = {}
    const ctx: DbCtx = {
      db: t.db,
      runInTransaction: async (ops) => {
        await write()
        afterWrite = everyRow(t.sqlite)
        await t.runInTransaction(ops)
      },
    }
    return { ctx, afterWrite: () => afterWrite }
  }

  it('fails the batch, writing nothing, when the one branch it copies goes between its reads and its batch', async () => {
    const race = racing(async () => t.runInTransaction(await branchDeleteOps(B)))

    await expect(
      duplicateStory({ storyId: STORY, title: TITLE, branch: { branchId: B } }, race.ctx),
    ).rejects.toThrow('NOT NULL constraint failed: stories.title')

    expect(countWhere('branches', 'id = ?', B)).toBe(0)
    expect(everyRow(t.sqlite)).toEqual(race.afterWrite())
  })

  it('fails the batch, writing nothing, when the story goes between its reads and its batch', async () => {
    const race = racing(() =>
      deleteStory(STORY, { db: t.db, runInTransaction: t.runInTransaction }, () =>
        listVecFamilyTables(t.db),
      ),
    )

    await expect(
      duplicateStory({ storyId: STORY, title: TITLE, branch: 'all' }, race.ctx),
    ).rejects.toThrow('NOT NULL constraint failed: stories.title')

    expect(countWhere('stories', 'id = ?', STORY)).toBe(0)
    expect(everyRow(t.sqlite)).toEqual(race.afterWrite())
  })

  it('fails the batch, writing nothing, when every branch it copies goes while the story stays', async () => {
    const D = 'br_d'
    const race = racing(async () => {
      cloneBranch(t.sqlite, B, D)
      t.sqlite.prepare('UPDATE stories SET current_branch_id = ? WHERE id = ?').run(D, STORY)
      await t.runInTransaction(await branchDeleteOps(A))
      await t.runInTransaction(await branchDeleteOps(B))
    })

    await expect(
      duplicateStory({ storyId: STORY, title: TITLE, branch: 'all' }, race.ctx),
    ).rejects.toThrow('NOT NULL constraint failed: stories.title')

    expect(countWhere('branches', 'story_id = ?', STORY)).toBe(1)
    expect(countWhere('stories', 'id = ?', STORY)).toBe(1)
    expect(everyRow(t.sqlite)).toEqual(race.afterWrite())
  })

  it('fails the batch, writing nothing, when a copied branch gains an unfinished run row before it', async () => {
    // Not vacuous: A's finished run row stands, and must not fail the batch.
    expect(countWhere('pipeline_runs', 'branch_id = ? AND finished_at IS NOT NULL', A)).toBe(1)
    const race = racing(async () => {
      t.sqlite
        .prepare(
          'INSERT INTO pipeline_runs (run_id, kind, action_id, story_id, branch_id, started_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('run_open_a', 'per-turn', 'act_open_a', STORY, A, AT)
    })

    await expect(
      duplicateStory({ storyId: STORY, title: TITLE, branch: { branchId: A } }, race.ctx),
    ).rejects.toThrow('NOT NULL constraint failed: stories.title')

    expect(everyRow(t.sqlite)).toEqual(race.afterWrite())
  })

  it("fails the batch, writing nothing, when a copied branch's classifier starts running before it", async () => {
    const race = racing(async () => setClassifierState(B, 'running'))

    await expect(
      duplicateStory({ storyId: STORY, title: TITLE, branch: 'all' }, race.ctx),
    ).rejects.toThrow('NOT NULL constraint failed: stories.title')

    expect(everyRow(t.sqlite)).toEqual(race.afterWrite())
  })

  it("fails the batch, writing nothing, when a copied branch's classifier status turns malformed before it", async () => {
    const race = racing(async () => {
      t.sqlite.prepare('UPDATE branches SET classifier_status = ? WHERE id = ?').run('{not json', B)
    })

    await expect(
      duplicateStory({ storyId: STORY, title: TITLE, branch: 'all' }, race.ctx),
    ).rejects.toThrow('NOT NULL constraint failed: stories.title')

    expect(everyRow(t.sqlite)).toEqual(race.afterWrite())
  })

  it('fails the batch, writing nothing, when a swap marker is stored on the source before it', async () => {
    const race = racing(async () => markSwap(STORY))

    await expect(
      duplicateStory({ storyId: STORY, title: TITLE, branch: 'all' }, race.ctx),
    ).rejects.toThrow('NOT NULL constraint failed: stories.title')

    expect(everyRow(t.sqlite)).toEqual(race.afterWrite())
  })

  it('fails the batch, writing nothing, when the source turns draft before it', async () => {
    const race = racing(async () => {
      t.sqlite.prepare("UPDATE stories SET status = 'draft' WHERE id = ?").run(STORY)
    })

    await expect(
      duplicateStory({ storyId: STORY, title: TITLE, branch: 'all' }, race.ctx),
    ).rejects.toThrow('NOT NULL constraint failed: stories.title')

    expect(everyRow(t.sqlite)).toEqual(race.afterWrite())
  })

  it('copies a source whose settings turn malformed before its batch, as the check reads no marker there', async () => {
    const race = racing(async () => {
      t.sqlite.prepare('UPDATE stories SET settings = ? WHERE id = ?').run('{not json', STORY)
    })

    const copy = copyOf(
      await duplicateStory({ storyId: STORY, title: TITLE, branch: 'all' }, race.ctx),
    )

    expect(storyRow(copy.storyId).settings).toBe('{not json')
  })

  it("copies one branch while the story's other branch's classifier runs at its batch", async () => {
    const race = racing(async () => setClassifierState(B, 'running'))

    const copy = copyOf(
      await duplicateStory({ storyId: STORY, title: TITLE, branch: { branchId: A } }, race.ctx),
    )

    expect(copy.branches).toHaveLength(1)
  })

  it("makes the copy's root current when the current leaf is switched off and deleted before its batch", async () => {
    seedTree()
    t.sqlite.prepare('UPDATE stories SET current_branch_id = ? WHERE id = ?').run(C, STORY)
    const race = racing(async () => {
      t.sqlite.prepare('UPDATE stories SET current_branch_id = ? WHERE id = ?').run(B, STORY)
      await t.runInTransaction(await branchDeleteOps(C))
    })

    const copy = copyOf(
      await duplicateStory({ storyId: STORY, title: TITLE, branch: 'all' }, race.ctx),
    )

    expect(copy.branches.map(({ name }) => name).sort()).toEqual([B_NAME, 'main'].sort())
    expect(storyRow(copy.storyId).current_branch_id).toBe(named(copy, 'main').id)
  })

  it("makes the copy's root current, not a child created before it, when the current leaf goes before its batch", async () => {
    seedTree()
    t.sqlite.prepare('UPDATE stories SET current_branch_id = ? WHERE id = ?').run(C, STORY)
    t.sqlite
      .prepare('UPDATE branches SET created_at = ? WHERE id = ?')
      .run(branchRow(A).created_at - 1, B)
    // Not vacuous: on created_at alone, the root's child would come first.
    expect(branchRow(B).created_at).toBeLessThan(branchRow(A).created_at)
    const race = racing(async () => {
      t.sqlite.prepare('UPDATE stories SET current_branch_id = ? WHERE id = ?').run(B, STORY)
      await t.runInTransaction(await branchDeleteOps(C))
    })

    const copy = copyOf(
      await duplicateStory({ storyId: STORY, title: TITLE, branch: 'all' }, race.ctx),
    )

    expect(copy.branches.map(({ name }) => name).sort()).toEqual([B_NAME, 'main'].sort())
    expect(storyRow(copy.storyId).current_branch_id).toBe(named(copy, 'main').id)
  })

  it('throws a failed batch, writing nothing and re-reading no store', async () => {
    const before = everyRow(t.sqlite)
    const failing: DbCtx = {
      db: t.db,
      runInTransaction: () => Promise.reject(new Error('disk I/O error')),
    }

    await expect(
      duplicateStory({ storyId: STORY, title: TITLE, branch: 'all' }, failing),
    ).rejects.toThrow('disk I/O error')

    expect(everyRow(t.sqlite)).toEqual(before)
    expect(storiesStore.getStories().rows).toEqual([])
  })
})

// data-model.md → Story duplicate: a copy keeps undo_payload verbatim, so a delete copied into
// the new story still names the source branch; Reverse-replay restores onto the branch it writes.
describe('CTRL-Z and redo in a copy', () => {
  const UNDO_STORY = 's_undo'
  const SOURCE = 'br_undo'
  const GONE = 'char_gone'
  const STAYS = 'char_stays'
  const REL = 'rel_pair'
  const HAP = 'hap_fire'
  const HAW = 'haw_fire'
  const DELETE_ACTION = 'act_gone'

  const character = (id: string): NewEntity => ({
    id,
    branchId: SOURCE,
    kind: 'character',
    name: id,
    status: 'active',
    injectionMode: 'auto',
    embeddingStale: 0,
    createdAt: AT,
    updatedAt: AT,
  })

  const branchesHolding = (table: string, id: string): unknown[] =>
    (
      t.sqlite
        .prepare(`SELECT branch_id FROM "${table}" WHERE id = ? ORDER BY branch_id`)
        .all(id) as {
        branch_id: unknown
      }[]
    ).map((row) => row.branch_id)

  // The source's newest group: a user's delete of GONE, capturing a relationship and an awareness
  // row in its payload.
  async function seedDeleteHead(): Promise<void> {
    await t.db.insert(stories).values({
      id: UNDO_STORY,
      title: 'The Fire',
      status: 'active',
      createdAt: AT,
      updatedAt: AT,
      currentBranchId: SOURCE,
    })
    await t.db
      .insert(branches)
      .values({ id: SOURCE, storyId: UNDO_STORY, name: 'main', createdAt: AT })
    await t.db.insert(entities).values([character(GONE), character(STAYS)])
    await t.db
      .insert(happenings)
      .values({ id: HAP, branchId: SOURCE, title: 'The barn fire', createdAt: AT, updatedAt: AT })
    // a_id < b_id: char_rel_canonical_order.
    await t.db.insert(characterRelationships).values({
      id: REL,
      branchId: SOURCE,
      aId: GONE,
      bId: STAYS,
      kind: 'ally',
      inverseKind: null,
      createdAt: AT,
      updatedAt: AT,
    })
    await t.db
      .insert(happeningAwareness)
      .values({ id: HAW, branchId: SOURCE, happeningId: HAP, characterId: GONE })
    const removed = await applyDeltaAction(
      {
        action: {
          kind: 'deleteEntity',
          source: 'user_edit',
          payload: { branchId: SOURCE, id: GONE },
        },
        actionId: DELETE_ACTION,
        branchId: SOURCE,
      },
      ctx,
    )
    if (removed.status !== 'ok') throw new Error(`deleteEntity: ${JSON.stringify(removed)}`)
  }

  it('undoes a delete copied from the source on the copy, and redoes it there, leaving the source alone', async () => {
    await seedDeleteHead()
    const copy = copyOf(
      await duplicateStory(
        { storyId: UNDO_STORY, title: 'The Fire (copy)', branch: { branchId: SOURCE } },
        ctx,
      ),
    )
    const [{ id: copyBranchId }] = copy.branches
    const [held] = t.sqlite
      .prepare(
        "SELECT undo_payload FROM deltas WHERE branch_id = ? AND action_id = ? AND op = 'delete' AND target_table = 'entities'",
      )
      .all(copyBranchId, DELETE_ACTION) as { undo_payload: string }[]
    // Not vacuous: the copy's delete still names the branch that wrote it, children included.
    expect(JSON.parse(held.undo_payload)).toMatchObject({
      branchId: SOURCE,
      relationships: [{ id: REL, branchId: SOURCE }],
      awareness: [{ id: HAW, branchId: SOURCE }],
    })
    const sourceBefore = branchSnapshot(t.sqlite, SOURCE)
    entriesStore.hydrate(copyBranchId, [])

    expect(await undoLastAction(copyBranchId, ctx)).toEqual({ status: 'ok' })

    expect(branchesHolding('entities', GONE)).toEqual([copyBranchId])
    expect(branchesHolding('character_relationships', REL)).toEqual([copyBranchId])
    expect(branchesHolding('happening_awareness', HAW)).toEqual([copyBranchId])
    expect(branchSnapshot(t.sqlite, SOURCE)).toEqual(sourceBefore)

    expect(await redoLastAction(copyBranchId, ctx)).toEqual({ status: 'ok' })

    expect(branchesHolding('entities', GONE)).toEqual([])
    expect(branchesHolding('character_relationships', REL)).toEqual([])
    expect(branchesHolding('happening_awareness', HAW)).toEqual([])
    expect(branchSnapshot(t.sqlite, SOURCE)).toEqual(sourceBefore)
    expect(undoRedoStore.hasRedo(copyBranchId)).toBe(false)
  })
})
