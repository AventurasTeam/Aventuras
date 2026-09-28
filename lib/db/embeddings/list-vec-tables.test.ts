import { describe, expect, it } from 'vitest'

import { ensureVecTablesSql, listVecFamilyTables } from './vec-tables'
import { createTestDb } from '../__tests__/test-db'

describe('listVecFamilyTables', () => {
  it("lists every dim family through the caller's handle and none of vec0's shadow tables", async () => {
    const { db, sqlite } = await createTestDb()
    for (const ddl of ensureVecTablesSql(8)) sqlite.exec(ddl)

    const tables = await listVecFamilyTables(db)

    expect(tables).toEqual(
      expect.arrayContaining(['entities_vec_384', 'entities_vec_8', 'chapter_summaries_vec_8']),
    )
    expect(tables.filter((name) => /_(info|chunks|rowids|vector_chunks\d+)$/.test(name))).toEqual(
      [],
    )
  })
})
