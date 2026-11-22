import { getTableColumns, getTableName } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'

import { dbSchema } from '../schema'
import { BRANCH_COPY_MANIFEST, type BranchCopyTableName } from './manifest'

const names = Object.keys(BRANCH_COPY_MANIFEST) as BranchCopyTableName[]

function valuesIn(mode: 'fork' | 'duplicate'): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, BRANCH_COPY_MANIFEST[name][mode]]))
}

describe('BRANCH_COPY_MANIFEST', () => {
  // data-model.md → Branch model: a branch-scoped table without a manifest row is a bug.
  it('has a row for exactly the schema tables with a branch column', () => {
    const schemaBranchTables = (Object.values(dbSchema) as SQLiteTable[])
      .filter((table) => 'branchId' in getTableColumns(table))
      .map(getTableName)
      .sort()
    expect([...names].sort()).toEqual(schemaBranchTables)
  })

  it('keys each row by the table it holds', () => {
    for (const name of names) expect(getTableName(BRANCH_COPY_MANIFEST[name].table)).toBe(name)
  })

  it('copies every table but probe captures and run records in a duplicate', () => {
    expect(valuesIn('duplicate')).toEqual({
      story_entries: 'copy',
      entities: 'copy',
      character_relationships: 'copy',
      lore: 'copy',
      threads: 'copy',
      happenings: 'copy',
      happening_involvements: 'copy',
      happening_awareness: 'copy',
      chapters: 'copy',
      branch_era_flips: 'copy',
      translations: 'copy',
      entry_assets: 'copy',
      probe_captures: 'skip',
      pipeline_runs: 'skip',
      deltas: 'copy',
      reversal_journals: 'copy',
    })
  })

  it('filters entries, deltas and journals at a fork, skips captures and runs, copies the rest', () => {
    expect(valuesIn('fork')).toEqual({
      story_entries: 'copy-non-system',
      entities: 'copy',
      character_relationships: 'copy',
      lore: 'copy',
      threads: 'copy',
      happenings: 'copy',
      happening_involvements: 'copy',
      happening_awareness: 'copy',
      chapters: 'copy',
      branch_era_flips: 'copy',
      translations: 'copy',
      entry_assets: 'copy',
      probe_captures: 'skip',
      pipeline_runs: 'skip',
      deltas: 'copy-survivors',
      reversal_journals: 'copy-survivors',
    })
  })

  // A fork's predicate may read a table copied earlier in its batch.
  it('copies deltas and reversal journals after every other table', () => {
    expect(names.slice(-2)).toEqual(['deltas', 'reversal_journals'])
  })
})
