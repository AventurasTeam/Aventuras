import { count, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { insertSeedSteps } from './insert'
import { createTestDb } from '../../lib/db/__tests__/test-db'
import { buildSeedSteps } from '../../lib/db/devtools/seed-dataset'
import { deltas } from '../../lib/db/schema'

describe('insertSeedSteps', () => {
  // 3,000 deltas of 12 columns bind 36,000 values, past SQLite's 32,766 in one statement.
  it('inserts a step too large for one statement', async () => {
    const { db } = await createTestDb()
    const rows = Array.from({ length: 3_000 }, (_, i) => ({
      id: `delta_bulk_${i}`,
      branchId: 'br_hero_main',
      entryId: null,
      actionId: 'act_bulk',
      logPosition: 100_000 + i,
      source: 'user_edit' as const,
      targetTable: 'story_entries',
      targetId: `entry_bulk_${i}`,
      op: 'update' as const,
      undoPayload: null,
      encodingVersion: 1,
      createdAt: 1,
    }))
    await insertSeedSteps(db, [...buildSeedSteps(), { name: 'deltas', table: deltas, rows }])
    const [bulk] = await db
      .select({ n: count() })
      .from(deltas)
      .where(eq(deltas.actionId, 'act_bulk'))
    expect(bulk!.n).toBe(3_000)
  })
})
