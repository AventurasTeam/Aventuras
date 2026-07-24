import type { DatabaseSync } from 'node:sqlite'

import { beforeEach, describe, expect, it } from 'vitest'

import { clearSwapTargetOp, setSwapTargetOp, setEmbeddingModelIdOp } from './settings-ops'
import { storySettingsSchema, type StorySettings } from './story-config-schema'
import { createTestDb } from '../__tests__/test-db'

describe('story settings ops', () => {
  let sqlite: DatabaseSync
  let runInTransaction: (ops: { sql: string; params: unknown[] }[]) => Promise<void>
  const now = Date.now()
  const NOW = now

  beforeEach(async () => {
    const testDb = await createTestDb()
    sqlite = testDb.sqlite
    runInTransaction = testDb.runInTransaction

    // Seed a story with valid settings containing embedding_model_id: 'old-model'
    const settings: StorySettings = {
      chapterTokenThreshold: 24000,
      chapterAutoClose: true,
      fullChapterInBuffer: false,
      partialChapterBuffer: 10,
      protectedBuffer: 10,
      classifierCadence: 5,
      piggybackMode: 'off',
      embeddingBackend: 'local',
      embedding_model_id: 'old-model',
      retrievalBudgets: { entities: 8, lore: 6, happenings: 6, threads: 4, chapters: 3 },
      probe_mode_active: false,
      composerModesEnabled: false,
      composerWrapPov: 'third',
      suggestionsEnabled: false,
      suggestionCount: 3,
      suggestionCategories: [],
      translation: {
        enabled: false,
        targetLanguage: null,
        granularToggles: {
          narrative: false,
          entityNames: false,
          entityDescriptions: false,
          lore: false,
          threads: false,
          happenings: false,
          chapterMeta: false,
        },
      },
      models: {},
      activePackId: null,
      packVariables: {},
    }

    sqlite
      .prepare(
        `insert into stories (id, title, settings, created_at, updated_at) values (?, ?, ?, ?, ?)`,
      )
      .run('s1', 'Test Story', JSON.stringify(settings), now, now)
  })

  function readSettings(storyId: string): StorySettings {
    const row = sqlite.prepare('select settings from stories where id = ?').get(storyId) as {
      settings: string
    }
    return storySettingsSchema.parse(JSON.parse(row.settings))
  }

  function readUpdatedAt(storyId: string): number {
    const row = sqlite.prepare('select updated_at from stories where id = ?').get(storyId) as {
      updated_at: number
    }
    return row.updated_at
  }

  it('setSwapTargetOp writes the marker and preserves sibling keys', async () => {
    await runInTransaction([setSwapTargetOp('s1', 'new-model', NOW)])
    const settings = readSettings('s1')
    expect(settings.embedding_swap_target).toBe('new-model')
    expect(settings.embedding_model_id).toBe('old-model')
  })

  it('clearSwapTargetOp removes the key entirely', async () => {
    await runInTransaction([setSwapTargetOp('s1', 'new-model', NOW)])
    await runInTransaction([clearSwapTargetOp('s1', NOW)])
    const settings = readSettings('s1')
    expect('embedding_swap_target' in settings).toBe(false)
  })

  it('setEmbeddingModelIdOp flips the recorded model', async () => {
    await runInTransaction([setEmbeddingModelIdOp('s1', 'new-model', NOW)])
    const settings = readSettings('s1')
    expect(settings.embedding_model_id).toBe('new-model')
  })

  it('setSwapTargetOp updates updated_at to the given timestamp', async () => {
    const laterTime = NOW + 1000
    await runInTransaction([setSwapTargetOp('s1', 'new-model', laterTime)])
    expect(readUpdatedAt('s1')).toBe(laterTime)
  })

  it('clearSwapTargetOp updates updated_at to the given timestamp', async () => {
    const laterTime = NOW + 1000
    await runInTransaction([setSwapTargetOp('s1', 'new-model', NOW)])
    await runInTransaction([clearSwapTargetOp('s1', laterTime)])
    expect(readUpdatedAt('s1')).toBe(laterTime)
  })

  it('setEmbeddingModelIdOp updates updated_at to the given timestamp', async () => {
    const laterTime = NOW + 1000
    await runInTransaction([setEmbeddingModelIdOp('s1', 'new-model', laterTime)])
    expect(readUpdatedAt('s1')).toBe(laterTime)
  })

  it('settings blob remains schema-valid after json_set', async () => {
    await runInTransaction([setSwapTargetOp('s1', 'new-model', NOW)])
    // readSettings calls storySettingsSchema.parse, which throws if invalid
    expect(() => readSettings('s1')).not.toThrow()
  })

  it('settings blob remains schema-valid after json_remove', async () => {
    await runInTransaction([setSwapTargetOp('s1', 'new-model', NOW)])
    await runInTransaction([clearSwapTargetOp('s1', NOW)])
    // readSettings calls storySettingsSchema.parse, which throws if invalid
    expect(() => readSettings('s1')).not.toThrow()
  })
})
