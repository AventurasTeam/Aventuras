import type { DatabaseSync } from 'node:sqlite'

import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, happeningAwareness, stories, type Delta } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { reverseAndPruneDeltaRows } from './reverse-replay'
import { selectReversalSet } from './row-closure'
import type { DbCtx } from '../types'

async function reverseRows(rows: readonly Delta[], ctx: DbCtx): Promise<number> {
  return reverseAndPruneDeltaRows(
    await selectReversalSet(ctx, { branchId: 'b1', target: rows }),
    ctx,
  )
}

// 8 cols → floor(32766/8)=4095 max rows/INSERT; 4200 rows forces a multi-statement restore.
const AWARENESS_ROW_COUNT = 4200

// The undo skips a link naming a missing row, so every aware character must exist.
function seedCharacters(sqlite: DatabaseSync): void {
  sqlite.exec(`
    WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ${AWARENESS_ROW_COUNT - 1})
    INSERT INTO entities (id, branch_id, kind, name, status, injection_mode, created_at, updated_at)
    SELECT 'char_' || i, 'b1', 'character', 'c', 'active', 'auto', 1, 1 FROM n`)
}

describe('reverse-replay of a delete cascade wider than the bind cap', () => {
  it('restores every child row across chunked statements', async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    const ctx: DbCtx = { db, runInTransaction }
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    seedCharacters(sqlite)

    const awareness = Array.from({ length: AWARENESS_ROW_COUNT }, (_, i) => ({
      id: `haw_${i}`,
      branchId: 'b1',
      happeningId: 'hap_1',
      characterId: `char_${i}`,
      learnedAtEntryId: null,
      decayResistance: null,
      retrievalCount: 0,
      source: null,
    }))

    const delta: Delta = {
      id: 'delta_1',
      branchId: 'b1',
      entryId: null,
      actionId: 'act_h',
      logPosition: 1,
      source: 'user_edit',
      targetTable: 'happenings',
      targetId: 'hap_1',
      op: 'delete',
      undoPayload: {
        id: 'hap_1',
        branchId: 'b1',
        title: 'Fire',
        description: null,
        category: null,
        icon: null,
        temporal: null,
        occurredAtEntryId: null,
        commonKnowledge: 0,
        embeddingStale: 0,
        createdAt: 1,
        updatedAt: 1,
        awareness,
      },
      encodingVersion: 1,
      createdAt: 1,
    }

    await reverseRows([delta], ctx)

    const restored = await db
      .select()
      .from(happeningAwareness)
      .where(
        and(eq(happeningAwareness.branchId, 'b1'), eq(happeningAwareness.happeningId, 'hap_1')),
      )
    expect(restored).toHaveLength(AWARENESS_ROW_COUNT)
  })

  it('restores every child row when the payload rows omit a defaulted column', async () => {
    // Binds per table column, not row key — a row-keys chunk size undercounts an omitted default.
    const { db, sqlite, runInTransaction } = await createTestDb()
    const ctx: DbCtx = { db, runInTransaction }
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    seedCharacters(sqlite)

    const awareness = Array.from({ length: AWARENESS_ROW_COUNT }, (_, i) => ({
      id: `haw_${i}`,
      branchId: 'b1',
      happeningId: 'hap_1',
      characterId: `char_${i}`,
      learnedAtEntryId: null,
      decayResistance: null,
      source: null,
    }))

    const delta: Delta = {
      id: 'delta_1',
      branchId: 'b1',
      entryId: null,
      actionId: 'act_h',
      logPosition: 1,
      source: 'user_edit',
      targetTable: 'happenings',
      targetId: 'hap_1',
      op: 'delete',
      undoPayload: {
        id: 'hap_1',
        branchId: 'b1',
        title: 'Fire',
        description: null,
        category: null,
        icon: null,
        temporal: null,
        occurredAtEntryId: null,
        commonKnowledge: 0,
        embeddingStale: 0,
        createdAt: 1,
        updatedAt: 1,
        awareness,
      },
      encodingVersion: 1,
      createdAt: 1,
    }

    await reverseRows([delta], ctx)

    const restored = await db
      .select()
      .from(happeningAwareness)
      .where(
        and(eq(happeningAwareness.branchId, 'b1'), eq(happeningAwareness.happeningId, 'hap_1')),
      )
    expect(restored).toHaveLength(AWARENESS_ROW_COUNT)
  })
})
