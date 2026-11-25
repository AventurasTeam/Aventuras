import { eq, getTableName } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import {
  branches,
  ensureVecTablesSql,
  isVecFamilyTable,
  packFloat32,
  pipelineRuns,
  sourceHash,
  stories,
  STORY_SETTINGS_DEFAULTS,
  storyDefinitionSchema,
  storyEntries,
  type DbCtx,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  branchSnapshot,
  cloneBranch,
  seedCopyFixture,
  type CopyFixture,
  type TestDb,
} from '@/lib/db/__tests__/two-branch'
import { plantVec } from '@/lib/db/__tests__/vec-fixtures'
import { logger } from '@/lib/diagnostics'
import { isStorySwapPending, readStorySwapPending } from '@/lib/embedder-swap'
import { PER_TURN_KIND, recoverInFlightRuns } from '@/lib/pipeline'
import {
  branchesStore,
  currentStoryStore,
  generationStore,
  isBranchHeld,
  readStoryBranches,
  refreshBranches,
  resetAllStores,
  undoRedoStore,
} from '@/lib/stores'

import {
  countBranchOnlyEntries,
  deleteBranch,
  type DeleteBranchRefusalCode,
  type DeleteBranchResult,
} from './delete-branch'
import { BRANCH_SCOPED, branchRowDeleteOps } from './delete-story'
import { __redoGroupForTest } from '../delta/redo'
import { readUnfinishedRuns } from '../delta/unfinished-runs'
import { writeSystemEntry } from '../story-entries/system-entry'
import { registerStoreOnlyRun } from '../turns/__tests__/stand-in-pass'

// Call-through spies: a test can reject the branch-list refresh, or act during the swap read, the
// last await before the batch.
vi.mock('@/lib/stores', async (importOriginal) => {
  const actual = await importOriginal<{
    refreshBranches: (db: DbCtx['db'], storyId: string) => Promise<void>
  }>()
  return { ...actual, refreshBranches: vi.fn(actual.refreshBranches) }
})
vi.mock('@/lib/embedder-swap', async (importOriginal) => {
  const actual = await importOriginal<{
    readStorySwapPending: (db: DbCtx['db'], storyId: string) => Promise<boolean>
  }>()
  return { ...actual, readStorySwapPending: vi.fn(actual.readStorySwapPending) }
})

const STORY: CopyFixture['storyId'] = 's_two'
// seedCopyFixture's branch: an opening, a user action and a reply, then a system line. B is a copy
// of A, so it holds every one of A's entry ids.
const A: CopyFixture['branchId'] = 'br_a'
const B = 'br_b'
// B's child, as a fork from B leaves it.
const C = 'br_c'
// A duplicate's shape: a branch of another story holding B's rows under B's ids.
const OTHER_STORY = 's_copy'
const OTHER_BRANCH = 'br_copy'
const OWN_ACTION = 'ent_b_action'
const OWN_REPLY = 'ent_b_reply'
const AT = 1_790_000_000_000
// Two dim families, so a delete that skips one family's table leaves a vector behind.
const DIMS = [4, 8] as const

let t: TestDb
let ctx: DbCtx
let fx: CopyFixture

beforeEach(async () => {
  resetAllStores()
  // mockReset puts back the call-through each vi.fn was built with, and drops a leftover Once.
  vi.mocked(refreshBranches).mockReset()
  vi.mocked(readStorySwapPending).mockReset()
  t = await createTestDb()
  ctx = { db: t.db, runInTransaction: t.runInTransaction }
  fx = await seedCopyFixture(t)
  cloneBranch(t.sqlite, A, B)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// Two entries of B's own after the history it shares with A, then a system line of its own:
// writeSystemEntry replaces the copied line, which carries A's id, under a fresh one.
async function writeOwnTurn(): Promise<void> {
  const { tail } = t.sqlite
    .prepare(
      "SELECT max(position) AS tail FROM story_entries WHERE branch_id = ? AND kind <> 'system'",
    )
    .get(B) as { tail: number }
  await t.db.insert(storyEntries).values([
    {
      id: OWN_ACTION,
      branchId: B,
      position: tail + 1,
      kind: 'user_action',
      content: 'I turn back for the herd.',
      createdAt: AT,
    },
    {
      id: OWN_REPLY,
      branchId: B,
      position: tail + 2,
      kind: 'ai_reply',
      content: 'The herd has scattered along the bank, and Mira is already riding for it.',
      createdAt: AT + 1,
    },
  ])
  await writeSystemEntry(
    { branchId: B, content: 'The reply stopped short. Retry to continue.' },
    ctx,
  )
}

function nonSystemIdsOf(branchId: string): string[] {
  const rows = t.sqlite
    .prepare("SELECT id FROM story_entries WHERE branch_id = ? AND kind <> 'system' ORDER BY id")
    .all(branchId) as { id: string }[]
  return rows.map(({ id }) => id)
}

function systemIdsOf(branchId: string): string[] {
  const rows = t.sqlite
    .prepare("SELECT id FROM story_entries WHERE branch_id = ? AND kind = 'system' ORDER BY id")
    .all(branchId) as { id: string }[]
  return rows.map(({ id }) => id)
}

function sharedWith(holder: string): string[] {
  const rows = t.sqlite
    .prepare(
      `SELECT b.id FROM story_entries b
       JOIN story_entries h ON h.id = b.id AND h.branch_id = ?
       WHERE b.branch_id = ? AND b.kind <> 'system' ORDER BY b.id`,
    )
    .all(holder, B) as { id: string }[]
  return rows.map(({ id }) => id)
}

describe('countBranchOnlyEntries', () => {
  it('counts only its own non-system entries: no shared id, not its system line', async () => {
    await writeOwnTurn()
    expect(sharedWith(A)).toHaveLength(3)
    expect(nonSystemIdsOf(B)).toHaveLength(5)
    expect(systemIdsOf(B)).toHaveLength(1)
    expect(systemIdsOf(A)).not.toContain(systemIdsOf(B)[0])

    expect(await countBranchOnlyEntries(B, ctx)).toBe(2)
  })

  it('counts 0 when another branch of the story holds every entry id', async () => {
    expect(sharedWith(A)).toEqual(nonSystemIdsOf(B))

    expect(await countBranchOnlyEntries(B, ctx)).toBe(0)
  })

  it("counts entries another story holds copies of as the branch's own", async () => {
    await writeOwnTurn()
    await t.db
      .insert(stories)
      .values({ id: OTHER_STORY, title: 'The Ford (copy)', createdAt: AT, updatedAt: AT })
    await t.db
      .insert(branches)
      .values({ id: OTHER_BRANCH, storyId: OTHER_STORY, name: 'main', createdAt: AT })
    cloneBranch(t.sqlite, B, OTHER_BRANCH)
    expect(sharedWith(OTHER_BRANCH)).toEqual(expect.arrayContaining([OWN_ACTION, OWN_REPLY]))

    expect(await countBranchOnlyEntries(B, ctx)).toBe(2)
  })

  it('counts 0 for a branch that is gone', async () => {
    expect(await countBranchOnlyEntries('br_gone', ctx)).toBe(0)
  })
})

type Tree = { forkEntryId: string; chapterId: string }
type BranchTable = (typeof BRANCH_SCOPED)[number]

// Unguarded: a delete reads no source row, so the vectors need not match one.
function plantVectors(branchIds: readonly string[]): void {
  for (const dim of DIMS) for (const ddl of ensureVecTablesSql(dim)) t.sqlite.exec(ddl)
  const rows = [
    ['entity', 'char_two_mira'],
    ['lore', 'lore_two_ford'],
  ] as const
  for (const branchId of branchIds) {
    for (const dim of DIMS) {
      for (const [kind, id] of rows) {
        plantVec(t.sqlite, {
          kind,
          id,
          branchId,
          modelId: `model-${dim}`,
          dim,
          sourceHash: sourceHash(`${kind}:${id}`),
          vector: packFloat32(new Float32Array(dim).fill(0.5)),
        })
      }
    }
  }
}

// C forks from B: B's rows under the same ids, a fork entry, and C the story's current branch.
// B carries a finished run row and an unfinished re-run of its close; all three hold vectors.
async function seedTree(): Promise<Tree> {
  cloneBranch(t.sqlite, B, C)
  const { forkEntryId } = t.sqlite
    .prepare(
      "SELECT id AS forkEntryId FROM story_entries WHERE branch_id = ? AND kind = 'ai_reply' ORDER BY position DESC LIMIT 1",
    )
    .get(C) as { forkEntryId: string }
  t.sqlite.prepare('UPDATE branches SET fork_entry_id = ? WHERE id = ?').run(forkEntryId, C)
  t.sqlite.prepare('UPDATE stories SET current_branch_id = ? WHERE id = ?').run(C, STORY)
  plantVectors([A, B, C])
  const { chapterId } = t.sqlite
    .prepare('SELECT id AS chapterId FROM chapters WHERE branch_id = ?')
    .get(B) as { chapterId: string }
  await t.db.insert(pipelineRuns).values([
    {
      runId: 'run_b_turn',
      kind: PER_TURN_KIND,
      actionId: 'act_b_turn',
      storyId: STORY,
      branchId: B,
      startedAt: AT,
      finishedAt: AT + 1,
      outcome: 'completed',
    },
    // Under the journal's action id, which B holds as A does: the same ids on two branches.
    {
      runId: 'run_b_rerun',
      kind: CHAPTER_CLOSE_KIND,
      actionId: fx.journalActionId,
      storyId: STORY,
      branchId: B,
      rerunChapterId: chapterId,
      startedAt: AT + 2,
    },
  ])
  return { forkEntryId, chapterId }
}

function rowCountOn(table: BranchTable, branchId: string): number {
  const { n } = t.sqlite
    .prepare(
      `SELECT count(*) AS n FROM "${getTableName(table)}" WHERE "${table.branchId.name}" = ?`,
    )
    .get(branchId) as { n: number }
  return n
}

// Each dim family's rows on the branch, keyed by table, every family listed.
function vectorsOn(branchId: string): Record<string, unknown[]> {
  const names = t.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[]
  const vectors: Record<string, unknown[]> = {}
  for (const { name } of names) {
    if (!isVecFamilyTable(name)) continue
    vectors[name] = t.sqlite
      .prepare(
        `SELECT pk, model_id, id, source_hash, hex(embedding) AS embedding FROM ${name} WHERE branch_id = ? ORDER BY pk`,
      )
      .all(branchId)
  }
  return vectors
}

function runRowsOn(branchId: string): unknown[] {
  return t.sqlite
    .prepare('SELECT * FROM pipeline_runs WHERE branch_id = ? ORDER BY run_id')
    .all(branchId)
}

// What a delete of another branch must keep: every branch table's rows, run rows and vectors.
function stateOf(branchId: string) {
  return {
    rows: branchSnapshot(t.sqlite, branchId),
    runs: runRowsOn(branchId),
    vectors: vectorsOn(branchId),
  }
}

function branchRow(
  branchId: string,
): { parent: string | null; forkEntry: string | null } | undefined {
  return t.sqlite
    .prepare(
      'SELECT parent_branch_id AS parent, fork_entry_id AS forkEntry FROM branches WHERE id = ?',
    )
    .get(branchId) as { parent: string | null; forkEntry: string | null } | undefined
}

function currentBranchOf(storyId: string): string | null {
  const { current } = t.sqlite
    .prepare('SELECT current_branch_id AS current FROM stories WHERE id = ?')
    .get(storyId) as { current: string | null }
  return current
}

function firstBranchOf(storyId: string): string {
  const { id } = t.sqlite
    .prepare('SELECT id FROM branches WHERE story_id = ? ORDER BY created_at, id LIMIT 1')
    .get(storyId) as { id: string }
  return id
}

function idsOn(table: 'chapters' | 'reversal_journals', branchId: string): string[] {
  const column = table === 'chapters' ? 'id' : 'action_id'
  const rows = t.sqlite
    .prepare(`SELECT ${column} AS id FROM ${table} WHERE branch_id = ? ORDER BY 1`)
    .all(branchId) as { id: string }[]
  return rows.map(({ id }) => id)
}

function assetIds(): string[] {
  const rows = t.sqlite.prepare('SELECT id FROM assets ORDER BY id').all() as { id: string }[]
  return rows.map(({ id }) => id)
}

describe('branchRowDeleteOps', () => {
  it('builds no op for no branch', () => {
    expect(branchRowDeleteOps(ctx.db, [], ['entities_vec_384'])).toEqual([])
  })
})

describe('deleteBranch', () => {
  let tree: Tree

  beforeEach(async () => {
    tree = await seedTree()
  })

  it('removes its rows in every branch table, its run rows, its vectors and its row', async () => {
    expect(rowCountOn(pipelineRuns, B)).toBe(2)
    expect(Object.values(vectorsOn(B)).flat()).toHaveLength(4)
    const before = { a: stateOf(A), aRow: branchRow(A), assets: assetIds() }

    expect(await deleteBranch(B, ctx)).toEqual({ status: 'deleted' })

    for (const table of BRANCH_SCOPED) expect(rowCountOn(table, B), getTableName(table)).toBe(0)
    expect(Object.values(vectorsOn(B)).flat()).toEqual([])
    expect(branchRow(B)).toBeUndefined()
    expect(branchRow(C)).toEqual({ parent: A, forkEntry: tree.forkEntryId })
    expect(stateOf(A)).toEqual(before.a)
    expect(branchRow(A)).toEqual(before.aRow)
    expect(assetIds()).toEqual(before.assets)
  })

  it("keeps the current branch's rows when its parent goes, and gives it that parent's parent", async () => {
    expect(currentBranchOf(STORY)).toBe(C)
    expect(branchRow(C)?.parent).toBe(B)
    const before = stateOf(C)

    expect(await deleteBranch(B, ctx)).toEqual({ status: 'deleted' })

    expect(stateOf(C)).toEqual(before)
    expect(branchRow(C)?.parent).toBe(A)
    expect(currentBranchOf(STORY)).toBe(C)
  })

  it("deletes the story's first branch, a root, leaving its child's parent null", async () => {
    expect(firstBranchOf(STORY)).toBe(A)
    expect(branchRow(A)?.parent).toBeNull()
    expect(rowCountOn(pipelineRuns, A)).toBe(1)
    const before = { b: stateOf(B), c: stateOf(C) }

    expect(await deleteBranch(A, ctx)).toEqual({ status: 'deleted' })

    for (const table of BRANCH_SCOPED) expect(rowCountOn(table, A), getTableName(table)).toBe(0)
    expect(Object.values(vectorsOn(A)).flat()).toEqual([])
    expect(branchRow(A)).toBeUndefined()
    expect(branchRow(B)?.parent).toBeNull()
    expect(branchRow(C)?.parent).toBe(B)
    expect({ b: stateOf(B), c: stateOf(C) }).toEqual(before)
  })

  it('leaves boot recovery nothing to reverse once a branch with an unfinished re-run goes', async () => {
    expect(await readUnfinishedRuns(B, ctx)).toEqual([
      {
        runId: 'run_b_rerun',
        kind: CHAPTER_CLOSE_KIND,
        actionId: fx.journalActionId,
        rerunChapterId: tree.chapterId,
      },
    ])
    for (const branchId of [A, B]) {
      expect(idsOn('chapters', branchId)).toContain(tree.chapterId)
      expect(idsOn('reversal_journals', branchId)).toContain(fx.journalActionId)
    }
    const before = stateOf(A)

    expect(await deleteBranch(B, ctx)).toEqual({ status: 'deleted' })

    expect(await recoverInFlightRuns(ctx)).toEqual({ reversed: [], failures: [] })
    expect(stateOf(A)).toEqual(before)
  })
})

const DEFINITION = storyDefinitionSchema.parse({
  mode: 'adventure',
  narration: 'first',
  genre: { label: 'Fantasy', promptBody: 'high fantasy' },
  tone: { label: 'Wry', promptBody: 'wry' },
  setting: 'A ford on a river in spate.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
})

type Records = { deferred: boolean; pendingClose: boolean; pendingRerun: boolean; held: boolean }
const ALL_RECORDS: Records = { deferred: true, pendingClose: true, pendingRerun: true, held: true }
const NO_RECORDS: Records = {
  deferred: false,
  pendingClose: false,
  pendingRerun: false,
  held: false,
}

function openStory(storyId: string, branchId: string): void {
  currentStoryStore.open({
    storyId,
    branchId,
    definition: DEFINITION,
    settings: STORY_SETTINGS_DEFAULTS,
  })
}

// The marker a swap leaves on the story's row; no store holds it until the story is opened.
async function storeSwapMarker(): Promise<void> {
  await t.db
    .update(stories)
    .set({ settings: { ...STORY_SETTINGS_DEFAULTS, embedding_swap_target: 'next-embedder' } })
    .where(eq(stories.id, STORY))
}

// A re-run whose abort's reversal didn't commit holds its branch.
function hold(branchId: string): void {
  const rerun = registerStoreOnlyRun(CHAPTER_CLOSE_KIND, branchId, 'rerun')
  generationStore.abortRun(rerun.runId, 'failed', { unreversed: true })
  expect(isBranchHeld(generationStore.getTxState(), branchId)).toBe(true)
}

// One of each record a branch can hold: a hold, a deferred pass, a close pick and a re-run.
function seedRecords(branchId: string): void {
  hold(branchId)
  const pass = registerStoreOnlyRun(PERIODIC_CLASSIFIER_KIND, branchId, 'pass')
  generationStore.abortRun(pass.runId, 'aborted')
  generationStore.setPendingClose(branchId, { endEntryId: `ent_${branchId}_end` })
  generationStore.setPendingRerun(branchId, { chapterId: `chap_${branchId}` })
}

function recordsOf(branchId: string): Records {
  const tx = generationStore.getTxState()
  return {
    deferred: tx.deferred.has(branchId),
    pendingClose: tx.pendingClose.has(branchId),
    pendingRerun: tx.pendingRerun.has(branchId),
    held: tx.heldBranches.has(branchId),
  }
}

const rowJson = (row: Record<string, unknown>): string =>
  JSON.stringify(row, (_key, value: unknown) =>
    value instanceof Uint8Array
      ? Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')
      : value,
  )

// Every ordinary table's rows as sorted JSON. vec0's shadow tables hold its vectors, so they stand
// in for the virtual tables.
function dbState(): Record<string, string[]> {
  const tables = t.sqlite
    .prepare("SELECT name, sql AS ddl FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string; ddl: string }[]
  const state: Record<string, string[]> = {}
  for (const { name, ddl } of tables) {
    if (/^CREATE VIRTUAL TABLE/i.test(ddl)) continue
    const rows = t.sqlite.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[]
    state[name] = rows.map(rowJson).sort()
  }
  return state
}

// A refusal writes nothing and drops nothing: every table as it was, the branch's redo kept.
async function expectRefused(
  code: DeleteBranchRefusalCode,
  branchId: string,
  run: () => Promise<DeleteBranchResult> = () => deleteBranch(branchId, ctx),
): Promise<void> {
  undoRedoStore.pushRedoGroup(__redoGroupForTest(branchId))
  const before = dbState()

  expect(await run()).toEqual({ status: 'rejected', code })

  expect(dbState(), 'the database').toEqual(before)
  expect(undoRedoStore.hasRedo(branchId), "the branch's redo stack").toBe(true)
}

describe('deleteBranch refusals', () => {
  beforeEach(async () => {
    await seedTree()
  })

  it("refuses the story's current branch", async () => {
    expect(currentBranchOf(STORY)).toBe(C)

    await expectRefused('current', C)
  })

  it("refuses the open branch when the story's pointer names another", async () => {
    openStory(STORY, B)
    expect(currentBranchOf(STORY)).toBe(C)

    await expectRefused('current', B)
  })

  it('refuses a branch that does not exist', async () => {
    await expectRefused('missing', 'br_gone')
  })

  it('refuses while a hard-gate run holds another story', async () => {
    registerStoreOnlyRun(PER_TURN_KIND, 'br_elsewhere')

    await expectRefused('gated', B)
  })

  it('refuses while a turn is pending on another branch', async () => {
    await expectRefused('gated', B, () =>
      generationStore.bracketPendingTurn('br_elsewhere', () => deleteBranch(B, ctx)),
    )
  })

  it('refuses while a prose reversal is in progress', async () => {
    generationStore.setReversalInProgress(true)

    await expectRefused('gated', B)
  })

  it('refuses a run that registers while its reads are in flight', async () => {
    vi.mocked(readStorySwapPending).mockImplementationOnce(async () => {
      registerStoreOnlyRun(PER_TURN_KIND, 'br_elsewhere')
      return false
    })

    await expectRefused('gated', B)
  })

  it('refuses on a swap marker stored on the story while another story is open', async () => {
    await storeSwapMarker()
    openStory(OTHER_STORY, OTHER_BRANCH)
    expect(isStorySwapPending(STORY)).toBe(false)

    await expectRefused('swap-pending', B)
  })

  it('refuses on a swap marker stored on the story with no story open', async () => {
    await storeSwapMarker()

    await expectRefused('swap-pending', B)
  })

  it('refuses a swap that turns pending on the open story while its reads are in flight', async () => {
    openStory(STORY, C)
    vi.mocked(readStorySwapPending).mockImplementationOnce(async () => {
      const open = currentStoryStore.getCurrentStory()!
      currentStoryStore.set({
        ...open,
        settings: { ...open.settings, embedding_swap_target: 'next-embedder' },
      })
      return false
    })

    await expectRefused('swap-pending', B)
  })
})

describe('deleteBranch and held branches', () => {
  beforeEach(async () => {
    await seedTree()
  })

  it('deletes another branch while the current branch is held', async () => {
    openStory(STORY, C)
    hold(C)
    // The store's convenience read counts the open branch's hold, so it would refuse here.
    expect(generationStore.isUserEditBlocked()).toBe(true)

    expect(await deleteBranch(B, ctx)).toEqual({ status: 'deleted' })

    expect(branchRow(B)).toBeUndefined()
    expect(isBranchHeld(generationStore.getTxState(), C)).toBe(true)
  })

  it('deletes a held branch and drops its hold', async () => {
    hold(B)

    expect(await deleteBranch(B, ctx)).toEqual({ status: 'deleted' })

    expect(branchRow(B)).toBeUndefined()
    expect(isBranchHeld(generationStore.getTxState(), B)).toBe(false)
  })
})

describe('deleteBranch after its commit', () => {
  beforeEach(async () => {
    await seedTree()
  })

  it("drops the branch's four records and its redo stack, and keeps another branch's", async () => {
    for (const branchId of [A, B]) {
      seedRecords(branchId)
      undoRedoStore.pushRedoGroup(__redoGroupForTest(branchId))
    }
    expect(recordsOf(B)).toEqual(ALL_RECORDS)

    expect(await deleteBranch(B, ctx)).toEqual({ status: 'deleted' })

    expect(recordsOf(B)).toEqual(NO_RECORDS)
    expect(undoRedoStore.hasRedo(B)).toBe(false)
    expect(recordsOf(A)).toEqual(ALL_RECORDS)
    expect(undoRedoStore.hasRedo(A)).toBe(true)
  })

  it('keeps every record and the redo stack when the batch fails', async () => {
    seedRecords(B)
    undoRedoStore.pushRedoGroup(__redoGroupForTest(B))
    const failing: DbCtx = {
      db: ctx.db,
      runInTransaction: () => Promise.reject(new Error('write failed')),
    }

    await expect(deleteBranch(B, failing)).rejects.toThrow('write failed')

    expect(recordsOf(B)).toEqual(ALL_RECORDS)
    expect(undoRedoStore.hasRedo(B)).toBe(true)
    expect(branchRow(B)).toBeDefined()
  })

  it('fails the batch, writing nothing, when a switch points the story at the branch before it', async () => {
    seedRecords(B)
    undoRedoStore.pushRedoGroup(__redoGroupForTest(B))
    let switched: Record<string, string[]> = {}
    const racing: DbCtx = {
      db: ctx.db,
      runInTransaction: async (ops) => {
        t.sqlite.prepare('UPDATE stories SET current_branch_id = ? WHERE id = ?').run(B, STORY)
        switched = dbState()
        await t.runInTransaction(ops)
      },
    }

    await expect(deleteBranch(B, racing)).rejects.toThrow(/NOT NULL constraint failed/)

    expect(currentBranchOf(STORY)).toBe(B)
    expect(Object.keys(switched).length).toBeGreaterThan(0)
    expect(dbState()).toEqual(switched)
    expect(recordsOf(B)).toEqual(ALL_RECORDS)
    expect(undoRedoStore.hasRedo(B)).toBe(true)
  })

  it("leaves the story's row as it was on a delete that lands", async () => {
    const before = t.sqlite.prepare('SELECT * FROM stories WHERE id = ?').get(STORY)

    expect(await deleteBranch(B, ctx)).toEqual({ status: 'deleted' })

    expect(t.sqlite.prepare('SELECT * FROM stories WHERE id = ?').get(STORY)).toEqual(before)
  })

  it("re-reads the open story's branch list without the branch", async () => {
    openStory(STORY, C)
    branchesStore.hydrate(STORY, await readStoryBranches(ctx.db, STORY))
    expect(branchesStore.getBranches(STORY).map(({ id }) => id)).toEqual([A, B, C])

    expect(await deleteBranch(B, ctx)).toEqual({ status: 'deleted' })

    expect(branchesStore.getBranches(STORY).map(({ id }) => id)).toEqual([A, C])
  })

  it('leaves the branch list alone while another story is open', async () => {
    openStory(OTHER_STORY, OTHER_BRANCH)
    const held = [
      { id: OTHER_BRANCH, name: 'main', parentBranchId: null, forkEntryId: null, createdAt: AT },
    ]
    branchesStore.hydrate(OTHER_STORY, held)

    expect(await deleteBranch(B, ctx)).toEqual({ status: 'deleted' })

    expect(vi.mocked(refreshBranches)).not.toHaveBeenCalled()
    expect(branchesStore.getBranches(OTHER_STORY)).toBe(held)
  })

  it('logs a refresh that rejects and still returns deleted, its drops made', async () => {
    openStory(STORY, C)
    seedRecords(B)
    undoRedoStore.pushRedoGroup(__redoGroupForTest(B))
    vi.mocked(refreshBranches).mockRejectedValueOnce(new Error('disk gone'))
    const warn = vi.spyOn(logger, 'warn')

    expect(await deleteBranch(B, ctx)).toEqual({ status: 'deleted' })

    expect(vi.mocked(refreshBranches)).toHaveBeenCalledWith(ctx.db, STORY)
    expect(warn).toHaveBeenCalledWith('app.branch_delete_refresh_failed', {
      storyId: STORY,
      branchId: B,
      error: 'disk gone',
    })
    expect(recordsOf(B)).toEqual(NO_RECORDS)
    expect(undoRedoStore.hasRedo(B)).toBe(false)
  })

  it('refuses a branch already gone, as a stale navigator row would, writing nothing', async () => {
    expect(await deleteBranch(B, ctx)).toEqual({ status: 'deleted' })

    expect(await countBranchOnlyEntries(B, ctx)).toBe(0)
    await expectRefused('missing', B)
  })
})
