import type { DatabaseSync } from 'node:sqlite'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearSwapTargetOp,
  embeddingTargetKey,
  sameEmbeddingTarget,
  setSwapTargetOp,
  setEmbeddingTargetOp,
  type EmbeddingTarget,
} from './settings-ops'
import { storySettingsSchema, type StorySettings } from './story-config-schema'
import { createTestDb } from '../__tests__/test-db'

describe('story settings ops', () => {
  let sqlite: DatabaseSync
  let runInTransaction: (ops: { sql: string; params: unknown[] }[]) => Promise<void>
  const now = Date.now()
  const NOW = now
  const LOCAL_TARGET = { modelId: 'new-model', backend: 'local' } as const
  const PROVIDER_TARGET = {
    modelId: 'text-embedding-3-small',
    backend: 'provider',
    providerId: 'prov1',
  } as const

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
    await runInTransaction([setSwapTargetOp('s1', LOCAL_TARGET, NOW)])
    const settings = readSettings('s1')
    expect(settings.embedding_swap_target).toBe('new-model')
    expect(settings.embedding_model_id).toBe('old-model')
  })

  it('clearSwapTargetOp removes the key entirely', async () => {
    await runInTransaction([setSwapTargetOp('s1', LOCAL_TARGET, NOW)])
    await runInTransaction([clearSwapTargetOp('s1', NOW)])
    const settings = readSettings('s1')
    expect('embedding_swap_target' in settings).toBe(false)
  })

  it('setSwapTargetOp records the target backend and provider id', async () => {
    await runInTransaction([setSwapTargetOp('s1', PROVIDER_TARGET, NOW)])
    const settings = readSettings('s1')
    expect(settings.embedding_swap_target).toBe('text-embedding-3-small')
    expect(settings.embedding_swap_backend).toBe('provider')
    expect(settings.embedding_swap_provider_id).toBe('prov1')
    // The flip has not happened yet: the story is still on its own backend.
    expect(settings.embeddingBackend).toBe('local')
  })

  it('setSwapTargetOp omits the provider id for a local target', async () => {
    await runInTransaction([setSwapTargetOp('s1', PROVIDER_TARGET, NOW)])
    await runInTransaction([setSwapTargetOp('s1', LOCAL_TARGET, NOW)])
    const settings = readSettings('s1')
    // A null in a json_patch DELETES the key rather than writing a JSON null,
    // which the settings Zod would reject — a stale provider id must not survive.
    expect('embedding_swap_provider_id' in settings).toBe(false)
    expect(settings.embedding_swap_backend).toBe('local')
  })

  it('clearSwapTargetOp removes all three marker keys', async () => {
    await runInTransaction([setSwapTargetOp('s1', PROVIDER_TARGET, NOW)])
    await runInTransaction([clearSwapTargetOp('s1', NOW)])
    const settings = readSettings('s1')
    expect('embedding_swap_target' in settings).toBe(false)
    expect('embedding_swap_backend' in settings).toBe(false)
    expect('embedding_swap_provider_id' in settings).toBe(false)
  })

  it('setEmbeddingTargetOp flips backend and provider id with the model', async () => {
    await runInTransaction([setEmbeddingTargetOp('s1', PROVIDER_TARGET, NOW)])
    const settings = readSettings('s1')
    expect(settings.embedding_model_id).toBe('text-embedding-3-small')
    expect(settings.embeddingBackend).toBe('provider')
    expect(settings.embedding_provider_id).toBe('prov1')
  })

  it('setEmbeddingTargetOp drops the provider id when flipping to local', async () => {
    await runInTransaction([setEmbeddingTargetOp('s1', PROVIDER_TARGET, NOW)])
    await runInTransaction([setEmbeddingTargetOp('s1', LOCAL_TARGET, NOW)])
    const settings = readSettings('s1')
    expect(settings.embeddingBackend).toBe('local')
    expect('embedding_provider_id' in settings).toBe(false)
  })

  it('setEmbeddingTargetOp drops effectiveDim when flipping to local', async () => {
    await runInTransaction([
      setEmbeddingTargetOp('s1', PROVIDER_TARGET, NOW),
      {
        sql: `UPDATE stories SET settings = json_patch(settings, json(?)) WHERE id = ?`,
        params: [JSON.stringify({ effectiveDim: 512 }), 's1'],
      },
    ])
    expect(readSettings('s1').effectiveDim).toBe(512)

    await runInTransaction([setEmbeddingTargetOp('s1', LOCAL_TARGET, NOW)])

    // Truncation is provider-only, so on a local story the dim describes nothing
    // while still reading as a live setting to anything that forgets to check.
    expect('effectiveDim' in readSettings('s1')).toBe(false)
  })

  it('setEmbeddingTargetOp keeps effectiveDim when flipping to another provider', async () => {
    await runInTransaction([
      setEmbeddingTargetOp('s1', PROVIDER_TARGET, NOW),
      {
        sql: `UPDATE stories SET settings = json_patch(settings, json(?)) WHERE id = ?`,
        params: [JSON.stringify({ effectiveDim: 512 }), 's1'],
      },
    ])

    await runInTransaction([
      setEmbeddingTargetOp(
        's1',
        { modelId: 'other', backend: 'provider', providerId: 'prov2' },
        NOW,
      ),
    ])

    expect(readSettings('s1').effectiveDim).toBe(512)
  })

  it('setEmbeddingModelIdOp flips the recorded model', async () => {
    await runInTransaction([setEmbeddingTargetOp('s1', LOCAL_TARGET, NOW)])
    const settings = readSettings('s1')
    expect(settings.embedding_model_id).toBe('new-model')
  })

  it('setSwapTargetOp updates updated_at to the given timestamp', async () => {
    const laterTime = NOW + 1000
    await runInTransaction([setSwapTargetOp('s1', LOCAL_TARGET, laterTime)])
    expect(readUpdatedAt('s1')).toBe(laterTime)
  })

  it('clearSwapTargetOp updates updated_at to the given timestamp', async () => {
    const laterTime = NOW + 1000
    await runInTransaction([setSwapTargetOp('s1', LOCAL_TARGET, NOW)])
    await runInTransaction([clearSwapTargetOp('s1', laterTime)])
    expect(readUpdatedAt('s1')).toBe(laterTime)
  })

  it('setEmbeddingModelIdOp updates updated_at to the given timestamp', async () => {
    const laterTime = NOW + 1000
    await runInTransaction([setEmbeddingTargetOp('s1', LOCAL_TARGET, laterTime)])
    expect(readUpdatedAt('s1')).toBe(laterTime)
  })

  it('settings blob remains schema-valid after json_set', async () => {
    await runInTransaction([setSwapTargetOp('s1', LOCAL_TARGET, NOW)])
    // readSettings calls storySettingsSchema.parse, which throws if invalid
    expect(() => readSettings('s1')).not.toThrow()
  })

  it('settings blob remains schema-valid after json_remove', async () => {
    await runInTransaction([setSwapTargetOp('s1', LOCAL_TARGET, NOW)])
    await runInTransaction([clearSwapTargetOp('s1', NOW)])
    // readSettings calls storySettingsSchema.parse, which throws if invalid
    expect(() => readSettings('s1')).not.toThrow()
  })
})

describe('embeddingTargetKey / sameEmbeddingTarget', () => {
  it('separates a locally installed model from a provider-served one', () => {
    const local: EmbeddingTarget = { modelId: 'shared-id', backend: 'local' }
    const served: EmbeddingTarget = {
      modelId: 'shared-id',
      backend: 'provider',
      providerId: 'prov1',
    }
    // The whole point: these are two embedders wearing the same name, and any
    // key that collapses them makes one of them unreachable.
    expect(embeddingTargetKey(local)).not.toBe(embeddingTargetKey(served))
    expect(sameEmbeddingTarget(local, served)).toBe(false)
  })

  it('separates the same model served by two different providers', () => {
    const a: EmbeddingTarget = { modelId: 'm', backend: 'provider', providerId: 'prov1' }
    const b: EmbeddingTarget = { modelId: 'm', backend: 'provider', providerId: 'prov2' }
    expect(sameEmbeddingTarget(a, b)).toBe(false)
  })

  it('ignores a provider id on a local target', () => {
    // A local model is the same local model whatever provider row happens to sit
    // beside it in settings, so a stray id must not fork its identity.
    expect(
      sameEmbeddingTarget(
        { modelId: 'm', backend: 'local' },
        {
          modelId: 'm',
          backend: 'local',
          providerId: 'prov1',
        },
      ),
    ).toBe(true)
  })

  it('treats an absent and a null provider id as the same target', () => {
    expect(
      sameEmbeddingTarget(
        { modelId: 'm', backend: 'provider' },
        {
          modelId: 'm',
          backend: 'provider',
          providerId: null,
        },
      ),
    ).toBe(true)
  })
})
