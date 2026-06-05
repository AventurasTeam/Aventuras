import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'

import { appSettings, branches, dbSchema, pipelineRuns, stories, storyEntries } from './schema'

describe('schema', () => {
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
        'stories',
        'storyEntries',
        'threads',
        'translations',
        'vaultCalendars',
      ].sort(),
    )
  })

  it('story_entries has a composite (branch_id, id) primary key', () => {
    const { primaryKeys } = getTableConfig(storyEntries)
    expect(primaryKeys).toHaveLength(1)
    expect(primaryKeys[0].columns.map((c) => c.name).sort()).toEqual(['branch_id', 'id'])
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

  it('app_settings is keyed on id', () => {
    expect(getTableConfig(appSettings).columns.find((c) => c.name === 'id')?.primary).toBe(true)
  })
})
