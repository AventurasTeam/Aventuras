import type { DatabaseSync } from 'node:sqlite'

import { desc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  branches,
  chapters,
  deltas,
  ensureVecTablesSql,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  lore,
  sourceHash,
  stories,
  threads,
  translations,
  vecTableName,
  type Delta,
  type VecTargetKind,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { plantVec } from '@/lib/db/__tests__/vec-fixtures'
import { happeningAwarenessStore, happeningInvolvementsStore } from '@/lib/stores'

import { applyDeltaAction } from './apply-delta-action'
import { applyRedo, snapshotForRedo } from './redo'
import { reverseAndPruneDeltaRows } from './reverse-replay'
import { selectReversalSet } from './row-closure'
import type { DbCtx } from '../types'

let ctx: DbCtx
let sqlite: DatabaseSync

beforeEach(async () => {
  const test = await createTestDb()
  ctx = { db: test.db, runInTransaction: test.runInTransaction }
  sqlite = test.sqlite
  for (const ddl of ensureVecTablesSql(8)) sqlite.exec(ddl)
  await ctx.db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await ctx.db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
})

const CASES = [
  {
    kind: 'lore',
    translationKind: 'lore',
    insert: () =>
      ctx.db.insert(lore).values({
        id: 'row_1',
        branchId: 'b1',
        title: 'Vael',
        body: 'b',
        injectionMode: 'auto',
        embeddingStale: 0,
        createdAt: 1,
        updatedAt: 1,
      }),
    remove: { kind: 'deleteLore', source: 'user_edit', payload: { branchId: 'b1', id: 'row_1' } },
    select: () => ctx.db.select().from(lore),
  },
  {
    kind: 'thread',
    translationKind: 'thread',
    insert: () =>
      ctx.db.insert(threads).values({
        id: 'row_1',
        branchId: 'b1',
        title: 'Debt',
        status: 'active',
        injectionMode: 'auto',
        embeddingStale: 0,
        createdAt: 1,
        updatedAt: 1,
      }),
    remove: { kind: 'deleteThread', source: 'user_edit', payload: { branchId: 'b1', id: 'row_1' } },
    select: () => ctx.db.select().from(threads),
  },
  {
    kind: 'chapter',
    translationKind: 'chapter',
    insert: () =>
      ctx.db.insert(chapters).values({
        id: 'row_1',
        branchId: 'b1',
        sequenceNumber: 1,
        title: 'I',
        summary: 's',
        theme: 't',
        startEntryId: 'e1',
        endEntryId: 'e2',
        tokenCount: 1,
        closedAt: 1,
        embeddingStale: 0,
        createdAt: 1,
        updatedAt: 1,
      }),
    remove: {
      kind: 'deleteChapter',
      source: 'user_edit',
      payload: { branchId: 'b1', id: 'row_1' },
    },
    select: () => ctx.db.select().from(chapters),
  },
  {
    kind: 'happening',
    translationKind: 'happening',
    insert: () =>
      ctx.db.insert(happenings).values({
        id: 'row_1',
        branchId: 'b1',
        title: 'Fire',
        embeddingStale: 0,
        createdAt: 1,
        updatedAt: 1,
      }),
    remove: {
      kind: 'deleteHappening',
      source: 'user_edit',
      payload: { branchId: 'b1', id: 'row_1' },
    },
    select: () => ctx.db.select().from(happenings),
  },
] as const

function insertVectors(kind: VecTargetKind): void {
  for (const dim of [384, 8]) {
    plantVec(sqlite, {
      kind,
      id: 'row_1',
      branchId: 'b1',
      modelId: `m${dim}`,
      dim,
      sourceHash: sourceHash('h'),
      vector: new Uint8Array(new Float32Array(dim).buffer),
    })
  }
}

function vectorCount(kind: VecTargetKind): number {
  const rows = sqlite
    .prepare(
      `SELECT (SELECT count(*) FROM ${vecTableName(kind, 384)} WHERE id = 'row_1') + (SELECT count(*) FROM ${vecTableName(kind, 8)} WHERE id = 'row_1') AS n`,
    )
    .all() as { n: number }[]
  return rows[0].n
}

async function groupRows(actionId: string): Promise<Delta[]> {
  return (await ctx.db
    .select()
    .from(deltas)
    .where(eq(deltas.actionId, actionId))
    .orderBy(desc(deltas.logPosition))) as Delta[]
}

describe.each(CASES)('delete $kind', ({ kind, translationKind, insert, remove, select }) => {
  it('sweeps its vectors and translations forward, restores the row stale on undo, sweeps again on redo', async () => {
    await insert()
    insertVectors(kind)
    expect(vectorCount(kind)).toBe(2)
    await ctx.db.insert(translations).values({
      id: 'tr_1',
      branchId: 'b1',
      targetKind: translationKind,
      targetId: 'row_1',
      field: 'title',
      language: 'cs',
      translatedText: 'x',
      createdAt: 1,
      updatedAt: 1,
    })

    expect(
      await applyDeltaAction({ action: remove, actionId: 'act_del', branchId: 'b1' }, ctx),
    ).toMatchObject({ status: 'ok' })
    expect(await select()).toEqual([])
    expect(vectorCount(kind)).toBe(0)
    expect(await ctx.db.select().from(translations)).toEqual([])

    const rows = await groupRows('act_del')
    const set = await selectReversalSet(ctx, { branchId: 'b1', target: rows })
    const snapshot = await snapshotForRedo(set, ctx)
    await reverseAndPruneDeltaRows(set, ctx, { keepRedoExact: false })
    const [restored] = await select()
    expect(restored?.embeddingStale).toBe(1)
    expect(await ctx.db.select().from(translations)).toHaveLength(1)

    insertVectors(kind)
    expect(vectorCount(kind)).toBe(2)
    await applyRedo(snapshot, ctx)
    expect(await select()).toEqual([])
    expect(vectorCount(kind)).toBe(0)
    expect(await ctx.db.select().from(translations)).toEqual([])
  })
})

describe('delete happening — link rows', () => {
  it('scopes the cascade to the branch, mirrors both link stores, and logs one delta', async () => {
    // b2 shares every id with b1 so a branch-filter-dropping cascade would hit the sibling's rows.
    await ctx.db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'm2', createdAt: 1 })
    await ctx.db.insert(happenings).values([
      { id: 'hap_1', branchId: 'b1', title: 'Fire', createdAt: 1, updatedAt: 1 },
      { id: 'hap_1', branchId: 'b2', title: 'Fire', createdAt: 1, updatedAt: 1 },
    ])
    await ctx.db.insert(entities).values(
      ['b1', 'b2'].map((branchId) => ({
        id: 'char_a',
        branchId,
        kind: 'character' as const,
        name: 'Aria',
        status: 'active' as const,
        injectionMode: 'auto' as const,
        createdAt: 1,
        updatedAt: 1,
      })),
    )
    const involvementB1 = {
      id: 'hinv_1',
      branchId: 'b1',
      happeningId: 'hap_1',
      entityId: 'char_a',
      role: null,
    }
    const involvementB2 = { ...involvementB1, branchId: 'b2' }
    await ctx.db.insert(happeningInvolvements).values([involvementB1, involvementB2])
    const awarenessB1 = {
      id: 'haw_1',
      branchId: 'b1',
      happeningId: 'hap_1',
      characterId: 'char_a',
      learnedAtEntryId: null,
      decayResistance: null,
      retrievalCount: 0,
      source: null,
    }
    const awarenessB2 = { ...awarenessB1, branchId: 'b2' }
    await ctx.db.insert(happeningAwareness).values([awarenessB1, awarenessB2])
    happeningInvolvementsStore.hydrate('b1', [involvementB1])
    happeningAwarenessStore.hydrate('b1', [awarenessB1])

    await applyDeltaAction(
      {
        action: {
          kind: 'deleteHappening',
          source: 'user_edit',
          payload: { branchId: 'b1', id: 'hap_1' },
        },
        actionId: 'act_h',
        branchId: 'b1',
      },
      ctx,
    )
    expect(happeningInvolvementsStore.getInvolvements().has('hinv_1')).toBe(false)
    expect(happeningAwarenessStore.getAwareness().has('haw_1')).toBe(false)
    expect(
      await ctx.db
        .select()
        .from(happeningInvolvements)
        .where(eq(happeningInvolvements.branchId, 'b2')),
    ).toEqual([involvementB2])
    expect(
      await ctx.db.select().from(happeningAwareness).where(eq(happeningAwareness.branchId, 'b2')),
    ).toEqual([awarenessB2])

    const rows = await groupRows('act_h')
    // Children ride the delete's own undo payload; they never log a delta of their own.
    expect(rows).toHaveLength(1)
    expect(rows[0]?.undoPayload).toMatchObject({
      involvements: [involvementB1],
      awareness: [awarenessB1],
    })

    await reverseAndPruneDeltaRows(
      await selectReversalSet(ctx, { branchId: 'b1', target: rows }),
      ctx,
      { keepRedoExact: false },
    )
    expect(await ctx.db.select().from(happeningInvolvements)).toHaveLength(2)
    expect(await ctx.db.select().from(happeningAwareness)).toHaveLength(2)
    expect(
      await ctx.db
        .select()
        .from(happeningInvolvements)
        .where(eq(happeningInvolvements.branchId, 'b2')),
    ).toEqual([involvementB2])
    expect(
      await ctx.db.select().from(happeningAwareness).where(eq(happeningAwareness.branchId, 'b2')),
    ).toEqual([awarenessB2])
    expect(happeningInvolvementsStore.getInvolvements().has('hinv_1')).toBe(true)
    expect(happeningAwarenessStore.getAwareness().has('haw_1')).toBe(true)
  })
})
