import { getTableName } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'

import {
  appSettings,
  branches,
  dbSchema,
  deltas,
  pipelineRuns,
  reversalJournals,
  stories,
  storyEntries,
} from './schema'

describe('schema', () => {
  it('keeps every column key clear of the payload-metadata prefix', () => {
    // `$`-prefixed keys in a delta's undo_payload are metadata, and reverse-replay
    // filters them out of the row it rebuilds (delta-encoding.ts -> PAYLOAD_META_PREFIX).
    // A column named that way would be filtered out of its own restore.
    const offenders = Object.entries(dbSchema).flatMap(([name, table]) =>
      getTableConfig(table)
        .columns.map((c) => c.name)
        .filter((c) => c.startsWith('$'))
        .map((c) => `${name}.${c}`),
    )
    expect(offenders).toEqual([])
  })

  it('exposes every relational table in dbSchema', () => {
    expect(Object.keys(dbSchema).sort()).toEqual(
      [
        'appSettings',
        'assets',
        'branchEraFlips',
        'branches',
        'chapters',
        'characterRelationships',
        'deltas',
        'entities',
        'entryAssets',
        'happeningAwareness',
        'happeningInvolvements',
        'happenings',
        'lore',
        'pipelineRuns',
        'probeCaptures',
        'reversalJournals',
        'stories',
        'storyEntries',
        'threads',
        'translations',
        'vaultCalendars',
        'wizardSessions',
      ].sort(),
    )
  })

  it('story_entries has a composite (branch_id, id) primary key', () => {
    const { primaryKeys } = getTableConfig(storyEntries)
    expect(primaryKeys).toHaveLength(1)
    expect(primaryKeys[0].columns.map((c) => c.name).sort()).toEqual(['branch_id', 'id'])
  })

  it('story_entries.content_tokens is a nullable integer', () => {
    const column = getTableConfig(storyEntries).columns.find((c) => c.name === 'content_tokens')
    expect(column?.notNull).toBe(false)
    expect(column?.getSQLType()).toBe('integer')
  })

  it('stories.current_branch_id is FK-less (cycle break)', () => {
    const { foreignKeys } = getTableConfig(stories)
    expect(foreignKeys).toHaveLength(0)
  })

  it('branches has story_id + parent_branch_id FKs; story_entries has branch_id FK', () => {
    expect(getTableConfig(branches).foreignKeys).toHaveLength(2)
    expect(getTableConfig(storyEntries).foreignKeys).toHaveLength(1)
  })

  it('declares pipeline_runs with run_id PK and nullable outcome', () => {
    const cols = getTableConfig(pipelineRuns).columns.map((c) => c.name)
    expect(cols).toEqual(
      expect.arrayContaining([
        'run_id',
        'kind',
        'action_id',
        'story_id',
        'started_at',
        'finished_at',
        'outcome',
      ]),
    )
    expect(getTableConfig(pipelineRuns).columns.find((c) => c.name === 'outcome')?.notNull).toBe(
      false,
    )
  })

  it('pipeline_runs.rerun_chapter_id is a nullable text column', () => {
    const column = getTableConfig(pipelineRuns).columns.find((c) => c.name === 'rerun_chapter_id')
    expect(column?.notNull).toBe(false)
    expect(column?.getSQLType()).toBe('text')
  })

  it('pipeline_runs.branch_id is a nullable text column whose one foreign key is to branches.id', () => {
    const { columns, foreignKeys } = getTableConfig(pipelineRuns)
    const column = columns.find((c) => c.name === 'branch_id')
    expect(column?.notNull).toBe(false)
    expect(column?.getSQLType()).toBe('text')
    expect(foreignKeys).toHaveLength(1)
    const reference = foreignKeys[0].reference()
    expect(reference.columns.map((c) => c.name)).toEqual(['branch_id'])
    expect(getTableName(reference.foreignTable)).toBe('branches')
    expect(reference.foreignColumns.map((c) => c.name)).toEqual(['id'])
  })

  it('deltas is keyed on (branch_id, id), with no key on id alone', () => {
    const { primaryKeys, columns } = getTableConfig(deltas)
    expect(primaryKeys).toHaveLength(1)
    expect(primaryKeys[0].columns.map((c) => c.name)).toEqual(['branch_id', 'id'])
    expect(columns.find((c) => c.name === 'id')?.primary).toBe(false)
  })

  it('reversal_journals is keyed on (branch_id, action_id) with a branch FK', () => {
    const { primaryKeys, foreignKeys } = getTableConfig(reversalJournals)
    expect(primaryKeys).toHaveLength(1)
    expect(primaryKeys[0].columns.map((c) => c.name).sort()).toEqual(['action_id', 'branch_id'])
    expect(foreignKeys).toHaveLength(1)
  })

  it('app_settings is keyed on id', () => {
    expect(getTableConfig(appSettings).columns.find((c) => c.name === 'id')?.primary).toBe(true)
  })
})
