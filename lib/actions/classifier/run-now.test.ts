import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { storyDefinitionSchema, storySettingsSchema } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { CLASSIFIER_HELD } from '@/lib/pipeline'
import { currentStoryStore } from '@/lib/stores'

import { runClassifierNow } from './run-now'

const runClassifierPass = vi.fn()

vi.mock('@/lib/pipeline', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runClassifierPass: (...args: unknown[]) => runClassifierPass(...args),
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
  classifierContextEntries: 4,
  piggybackMode: 'off',
  embeddingBackend: 'local',
  embedding_model_id: 'm',
  retrievalBudgets: { entities: 1, lore: 1, happenings: 1, threads: 1, chapters: 1 },
  keywordRetrieval: {
    mode: 'boost',
    budgetShare: 0.5,
    scanEntries: 1,
    cascade: false,
    cascadeMaxDepth: 2,
  },
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

function open(branchId: string): void {
  currentStoryStore.set({ storyId: 's1', branchId, definition: DEFINITION, settings: SETTINGS })
}

describe('runClassifierNow', () => {
  beforeEach(() => {
    runClassifierPass.mockReset()
    currentStoryStore.__reset()
  })
  afterEach(() => {
    currentStoryStore.__reset()
  })

  it('rejects when the branch is not open', async () => {
    open('b-other')
    const { db, runInTransaction } = await createTestDb()

    const result = await runClassifierNow('b1', { db, runInTransaction })

    expect(result).toEqual({ outcome: 'rejected', blockedBy: 'branch-not-open' })
    expect(runClassifierPass).not.toHaveBeenCalled()
  })

  // Exact arguments: a `beforeTurn` anywhere would show Run now's pass as Send's.
  it('starts the pass on the open story’s branch, never as Send’s', async () => {
    open('b1')
    const { db, runInTransaction } = await createTestDb()
    runClassifierPass.mockResolvedValue({ outcome: 'completed' })

    const result = await runClassifierNow('b1', { db, runInTransaction })

    expect(runClassifierPass.mock.calls).toStrictEqual([
      [
        { storyId: 's1', branchId: 'b1' },
        { db, runInTransaction },
      ],
    ])
    expect(result).toEqual({ outcome: 'completed' })
  })

  it('passes the starter’s held refusal through unchanged', async () => {
    open('b1')
    const { db, runInTransaction } = await createTestDb()
    runClassifierPass.mockResolvedValue({ outcome: 'rejected', blockedBy: CLASSIFIER_HELD })

    const result = await runClassifierNow('b1', { db, runInTransaction })

    expect(result).toEqual({ outcome: 'rejected', blockedBy: CLASSIFIER_HELD })
  })
})
