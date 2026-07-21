import { DatabaseSync } from 'node:sqlite'

import { getLoadablePath } from 'sqlite-vec'
import { describe, expect, it } from 'vitest'

import {
  VEC_FAMILIES,
  ensureVecTables,
  ensureVecTablesSql,
  vecRowPk,
  vecTableName,
} from './vec-tables'
import type { VecTargetKind } from './vec-tables'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { allowExtension: true })
  db.loadExtension(getLoadablePath())
  return db
}

describe('vecTableName', () => {
  it('maps kind + dim to the dim-suffixed family table name', () => {
    expect(vecTableName('entity', 768)).toBe('entities_vec_768')
    expect(vecTableName('lore', 768)).toBe('lore_vec_768')
    expect(vecTableName('happening', 768)).toBe('happenings_vec_768')
    expect(vecTableName('thread', 768)).toBe('threads_vec_768')
  })

  it('maps chapter to the chapter_summaries family', () => {
    expect(vecTableName('chapter', 768)).toBe('chapter_summaries_vec_768')
  })

  it('rejects a non-positive-integer dim', () => {
    expect(() => vecTableName('entity', 0)).toThrow()
    expect(() => vecTableName('entity', -1)).toThrow()
    expect(() => vecTableName('entity', 1.5)).toThrow()
    expect(() => vecTableName('entity', NaN)).toThrow()
  })
})

describe('vecRowPk', () => {
  it('joins branchId and id with a colon separator', () => {
    expect(vecRowPk('b1', 'e1')).toBe('b1:e1')
  })
})

describe('ensureVecTablesSql', () => {
  it('emits one CREATE VIRTUAL TABLE IF NOT EXISTS per family, at the given dim', () => {
    const statements = ensureVecTablesSql(768)
    expect(statements).toHaveLength(5)
    for (const kind of Object.keys(VEC_FAMILIES) as VecTargetKind[]) {
      const tableName = vecTableName(kind, 768)
      const matching = statements.filter((s) => s.includes(tableName))
      expect(matching).toHaveLength(1)
      expect(matching[0]).toContain('IF NOT EXISTS')
      expect(matching[0]).toContain('USING vec0')
      expect(matching[0]).toContain('float[768]')
    }
  })

  it('declares pk as the primary key and id as plain metadata', () => {
    const [statement] = ensureVecTablesSql(768)
    expect(statement).toContain('pk text primary key')
    expect(statement).toContain('branch_id text partition key')
    expect(statement).toContain('model_id text')
    expect(statement).toContain('id text')
    expect(statement).toContain('+source_hash text')
    expect(statement).not.toContain('id text primary key')
  })
})

describe('ensureVecTables', () => {
  it('creates all five 768-dim vec0 tables via the exec seam', async () => {
    const db = makeDb()
    await ensureVecTables(768, async (sql) => {
      db.exec(sql)
    })

    const names = (
      db
        .prepare("select name from sqlite_master where type = 'table' and name like '%_vec_768'")
        .all() as { name: string }[]
    ).map((r) => r.name)

    expect(names.sort()).toEqual(
      [
        'entities_vec_768',
        'lore_vec_768',
        'happenings_vec_768',
        'threads_vec_768',
        'chapter_summaries_vec_768',
      ].sort(),
    )
  })

  it('is idempotent — running it twice does not throw', async () => {
    const db = makeDb()
    const exec = async (sql: string) => {
      db.exec(sql)
    }
    await ensureVecTables(768, exec)
    await expect(ensureVecTables(768, exec)).resolves.not.toThrow()
  })
})
