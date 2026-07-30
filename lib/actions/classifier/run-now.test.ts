import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { storyDefinitionSchema, storySettingsSchema } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { currentStoryStore } from '@/lib/stores'

import { runClassifierNow } from './run-now'

const ensurePeriodicClassifierPipelineRegistered = vi.fn()
const runPipeline = vi.fn()

vi.mock('@/lib/pipeline', () => ({
  ensurePeriodicClassifierPipelineRegistered: (...args: unknown[]) =>
    ensurePeriodicClassifierPipelineRegistered(...args),
  runPipeline: (...args: unknown[]) => runPipeline(...args),
}))

const DEFINITION = storyDefinitionSchema.parse({
  mode: 'adventure',
  leadEntityId: 'char_00000000-0000-4000-8000-000000000001',
  narration: 'first',
  genre: { label: 'Fantasy', promptBody: 'high fantasy' },
  tone: { label: 'Wry', promptBody: 'wry' },
  setting: 'A keep on a hill.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
})
const SETTINGS = storySettingsSchema.parse({
  classifierCadence: 8,
  piggybackMode: 'off',
  embeddingBackend: 'local',
  embedding_model_id: 'm',
  retrievalBudgets: { entities: 1, lore: 1, happenings: 1, threads: 1, chapters: 1 },
  composerModesEnabled: true,
  composerWrapPov: 'first',
  suggestionsEnabled: false,
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
  activePackId: 'pack_bundled_default',
  packVariables: {},
})

describe('runClassifierNow', () => {
  beforeEach(() => {
    ensurePeriodicClassifierPipelineRegistered.mockReset()
    runPipeline.mockReset()
    currentStoryStore.__reset()
  })
  afterEach(() => currentStoryStore.__reset())

  it('rejects when the branch is not open', async () => {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition: DEFINITION,
      settings: SETTINGS,
    })
    const { db, runInTransaction } = await createTestDb()

    const result = await runClassifierNow('b-other', { db, runInTransaction })

    expect(result).toEqual({ outcome: 'rejected', blockedBy: 'branch-not-open' })
    expect(runPipeline).not.toHaveBeenCalled()
  })

  it('calls runPipeline with the open story storyId/branchId', async () => {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition: DEFINITION,
      settings: SETTINGS,
    })
    const { db, runInTransaction } = await createTestDb()
    runPipeline.mockResolvedValue({ outcome: 'completed' })

    const result = await runClassifierNow('b1', { db, runInTransaction })

    expect(ensurePeriodicClassifierPipelineRegistered).toHaveBeenCalled()
    expect(runPipeline).toHaveBeenCalledWith(
      PERIODIC_CLASSIFIER_KIND,
      expect.objectContaining({ storyId: 's1', branchId: 'b1', db, runInTransaction }),
    )
    expect(result).toEqual({ outcome: 'completed' })
  })

  it('passes through a rejected outcome unchanged', async () => {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition: DEFINITION,
      settings: SETTINGS,
    })
    const { db, runInTransaction } = await createTestDb()
    runPipeline.mockResolvedValue({ outcome: 'rejected', blockedBy: 'chapter-close' })

    const result = await runClassifierNow('b1', { db, runInTransaction })

    expect(result).toEqual({ outcome: 'rejected', blockedBy: 'chapter-close' })
  })
})
