import { describe, expect, it } from 'vitest'

import { createTestDb } from './test-db'
import { SOURCE_TABLES } from '../embeddings/stale'
import { branches, stories } from '../schema'

// Raw SQL, not a drizzle insert: drizzle fills the column from the schema default, so only
// a statement that names no embedding_stale reads the DB's own default. Typed off
// SOURCE_TABLES so a sixth embeddable kind fails to compile instead of going unchecked.
type EmbeddableTable = (typeof SOURCE_TABLES)[keyof typeof SOURCE_TABLES]

const OMITTING_THE_COLUMN: Record<EmbeddableTable, string> = {
  chapters: `INSERT INTO chapters (id, branch_id, sequence_number, title, summary, theme,
      start_entry_id, end_entry_id, token_count, closed_at, created_at, updated_at)
    VALUES ('c1', 'b1', 1, 't', 's', 'th', 'e1', 'e2', 0, 1, 1, 1)`,
  entities: `INSERT INTO entities (id, branch_id, kind, name, status, injection_mode, created_at, updated_at)
    VALUES ('x1', 'b1', 'character', 'n', 'active', 'auto', 1, 1)`,
  happenings: `INSERT INTO happenings (id, branch_id, title, created_at, updated_at)
    VALUES ('h1', 'b1', 't', 1, 1)`,
  lore: `INSERT INTO lore (id, branch_id, title, injection_mode, created_at, updated_at)
    VALUES ('l1', 'b1', 't', 'auto', 1, 1)`,
  threads: `INSERT INTO threads (id, branch_id, title, status, injection_mode, created_at, updated_at)
    VALUES ('t1', 'b1', 't', 'open', 'auto', 1, 1)`,
}

describe('embedding_stale column default', () => {
  // Nothing re-derives the flag outside an embedder swap: a row that starts wrongly-clean
  // hides an absent vector forever. Defaulting dirty makes a forgotten column cheap.
  it.each(Object.values(SOURCE_TABLES))(
    'defaults %s rows to dirty when the insert omits the column',
    async (table) => {
      const { db, sqlite } = await createTestDb()
      await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
      await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'main', createdAt: 1 })

      sqlite.exec(OMITTING_THE_COLUMN[table])

      const row = sqlite.prepare(`SELECT embedding_stale AS s FROM ${table}`).get() as { s: number }
      expect(row.s).toBe(1)
    },
  )
})
