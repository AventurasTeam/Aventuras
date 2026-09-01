import type { StoryEntry } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entriesStore } from '@/lib/stores'

const BRANCH_IDS = ['b1', 'b2', 'b-other']

/**
 * A real database for phases that read their own data rather than taking it
 * from a caller. Seeds the story and branch rows `story_entries` references, so
 * a case only has to state its entries.
 */
export async function createPhaseDb(): Promise<Awaited<ReturnType<typeof createTestDb>>> {
  const testDb = await createTestDb()
  testDb.sqlite.exec(`
    INSERT INTO stories (id, title, created_at, updated_at) VALUES ('s1', 'A story', 1, 1);
    INSERT INTO stories (id, title, created_at, updated_at) VALUES ('s2', 'Another', 1, 1);
    ${BRANCH_IDS.map(
      (id) =>
        `INSERT INTO branches (id, story_id, name, created_at) VALUES ('${id}', 's1', '${id}', 1);`,
    ).join('\n')}
  `)
  return testDb
}

/**
 * Hydrates the store and writes the same rows to the database. Synchronous, so
 * it drops in wherever `entriesStore.hydrate` already stood — hence node:sqlite
 * directly rather than the async drizzle handle.
 *
 * The two sources agree only on the first call after a reset: a later hydrate
 * replaces the store but only adds to the database, which is how a case makes
 * them disagree on purpose.
 */
export function hydrateEntries(
  testDb: Awaited<ReturnType<typeof createTestDb>>,
  branchId: string,
  rows: readonly StoryEntry[],
): void {
  entriesStore.hydrate(branchId, [...rows])
  const stmt = testDb.sqlite.prepare(
    `INSERT OR REPLACE INTO story_entries
       (id, branch_id, position, kind, content, chapter_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  // Columns the store never reads are routinely absent from a phase fixture,
  // which the `as never` casts at those call sites hide. Defaulted rather than
  // rejected so a case states only what it is about; a case that means a system
  // row or a closed chapter always says so.
  for (const row of rows) {
    stmt.run(
      row.id,
      row.branchId ?? branchId,
      row.position,
      row.kind ?? 'ai_reply',
      row.content ?? '',
      row.chapterId ?? null,
      row.metadata === null || row.metadata === undefined ? null : JSON.stringify(row.metadata),
      row.createdAt ?? row.position,
    )
  }
}

export function resetPhaseDb(testDb: Awaited<ReturnType<typeof createTestDb>>): void {
  testDb.sqlite.exec('DELETE FROM story_entries')
}
