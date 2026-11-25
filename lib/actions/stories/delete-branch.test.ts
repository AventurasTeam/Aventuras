import { beforeEach, describe, expect, it } from 'vitest'

import { branches, stories, storyEntries, type DbCtx } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  cloneBranch,
  seedCopyFixture,
  type CopyFixture,
  type TestDb,
} from '@/lib/db/__tests__/two-branch'
import { resetAllStores } from '@/lib/stores'

import { countBranchOnlyEntries } from './delete-branch'
import { writeSystemEntry } from '../story-entries/system-entry'

// seedCopyFixture's branch: an opening, a user action and a reply, then a system line. B is a copy
// of A, so it holds every one of A's entry ids.
const A: CopyFixture['branchId'] = 'br_a'
const B = 'br_b'
// A duplicate's shape: a branch of another story holding B's rows under B's ids.
const OTHER_STORY = 's_copy'
const OTHER_BRANCH = 'br_copy'
const OWN_ACTION = 'ent_b_action'
const OWN_REPLY = 'ent_b_reply'
const AT = 1_790_000_000_000

let t: TestDb
let ctx: DbCtx

beforeEach(async () => {
  resetAllStores()
  t = await createTestDb()
  ctx = { db: t.db, runInTransaction: t.runInTransaction }
  await seedCopyFixture(t)
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
