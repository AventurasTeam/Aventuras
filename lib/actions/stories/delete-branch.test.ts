import { getTableName } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import {
  branches,
  ensureVecTablesSql,
  isVecFamilyTable,
  packFloat32,
  pipelineRuns,
  sourceHash,
  stories,
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
import { PER_TURN_KIND, recoverInFlightRuns } from '@/lib/pipeline'
import { resetAllStores } from '@/lib/stores'

import { countBranchOnlyEntries, deleteBranch } from './delete-branch'
import { BRANCH_SCOPED, branchRowDeleteOps } from './delete-story'
import { readUnfinishedRuns } from '../delta/unfinished-runs'
import { writeSystemEntry } from '../story-entries/system-entry'

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
  t = await createTestDb()
  ctx = { db: t.db, runInTransaction: t.runInTransaction }
  fx = await seedCopyFixture(t)
  cloneBranch(t.sqlite, A, B)
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

// B's non-system entry ids that `holder` holds too.
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
    const before = { a: stateOf(A), assets: assetIds() }

    expect(await deleteBranch(B, ctx)).toEqual({ status: 'deleted' })

    for (const table of BRANCH_SCOPED) expect(rowCountOn(table, B), getTableName(table)).toBe(0)
    expect(Object.values(vectorsOn(B)).flat()).toEqual([])
    expect(branchRow(B)).toBeUndefined()
    expect(branchRow(C)).toEqual({ parent: A, forkEntry: tree.forkEntryId })
    expect(stateOf(A)).toEqual(before.a)
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
