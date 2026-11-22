import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, deltas, happeningInvolvements, happenings, stories, type Delta } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import {
  buildReverseAndPrunePlan,
  restoringUpdates,
  reverseAndPruneDeltaRows,
  reverseReplayDeltas,
} from './reverse-replay'
import { selectReversalSet } from './row-closure'

const delta = (
  id: string,
  logPosition: number,
  over: Partial<Delta> & Pick<Delta, 'targetTable' | 'targetId'>,
): Delta => ({
  id,
  branchId: 'b1',
  actionId: 'act_run',
  op: 'create',
  entryId: null,
  source: 'periodic_classifier',
  undoPayload: null,
  logPosition,
  encodingVersion: 1,
  createdAt: logPosition,
  ...over,
})

// A pass that created hap_run, then the user renamed it and added an involvement under it.
async function seed() {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  await db.insert(happenings).values({
    id: 'hap_run',
    branchId: 'b1',
    title: 'renamed by the user',
    createdAt: 1,
    updatedAt: 2,
  })
  await db
    .insert(happeningInvolvements)
    .values({ id: 'hinv_user', branchId: 'b1', happeningId: 'hap_run', entityId: 'char_k' })
  await db.insert(deltas).values([
    delta('d_create', 1, { targetTable: 'happenings', targetId: 'hap_run' }),
    delta('d_rename', 2, {
      actionId: 'act_user',
      source: 'user_edit',
      op: 'update',
      targetTable: 'happenings',
      targetId: 'hap_run',
      undoPayload: { title: 'from the pass' },
    }),
    delta('d_inv', 3, {
      actionId: 'act_user2',
      source: 'user_edit',
      targetTable: 'happening_involvements',
      targetId: 'hinv_user',
    }),
  ])
  return { db, ctx: { db, runInTransaction } }
}

describe('the reversal closure', () => {
  it("reverses a user's later writes to a row the aborted run created, and prunes them", async () => {
    const { db, ctx } = await seed()

    expect(await reverseReplayDeltas('act_run', ctx)).toBe(3)

    expect(await db.select().from(happenings)).toEqual([])
    expect(await db.select().from(happeningInvolvements)).toEqual([])
    expect(await db.select().from(deltas).where(eq(deltas.branchId, 'b1'))).toEqual([])
  })

  it("leaves out a later delete of the row, whose undo would restore the row's children", async () => {
    const { db, ctx } = await seed()
    await db.insert(deltas).values(
      delta('d_delete', 4, {
        actionId: 'act_user3',
        source: 'user_edit',
        op: 'delete',
        targetTable: 'happenings',
        targetId: 'hap_run',
      }),
    )

    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: [delta('d_create', 1, { targetTable: 'happenings', targetId: 'hap_run' })],
    })

    expect(set.rows.map((d) => d.id)).toEqual(['d_inv', 'd_rename', 'd_create'])
  })
})

describe('a set selected with reversedFirst', () => {
  it('goes to the counting readers and to no reversal', async () => {
    const { ctx } = await seed()
    const counted = await selectReversalSet(ctx, { branchId: 'b1', target: [], reversedFirst: [] })

    const reversals = [
      // @ts-expect-error it nulls refs as if live deltas were gone, which CTRL-Z can't restore
      () => reverseAndPruneDeltaRows(counted, ctx, { keepRedoExact: false }),
      // @ts-expect-error nor does the plan every reversal commits take it
      () => buildReverseAndPrunePlan(counted, ctx, { keepRedoExact: false }),
    ]

    expect(reversals).toHaveLength(2)
    expect(await restoringUpdates(counted, ctx)).toEqual(new Set())
  })
})
