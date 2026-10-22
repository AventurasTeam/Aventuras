import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { idleStatus, PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import {
  branches,
  stories,
  storyDefinitionSchema,
  storySettingsSchema,
  type ClassifierStatus,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { currentStoryStore, generationStore, type RunState } from '@/lib/stores'

import { runClassifierNow } from './run-now'

const ensurePeriodicClassifierPipelineRegistered = vi.fn()
const runPipeline = vi.fn()

// The real module but for the two calls that start a pass, so the held check runs as shipped.
vi.mock('@/lib/pipeline', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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

async function seedBranch(state: ClassifierStatus['state']) {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({
    id: 'b1',
    storyId: 's1',
    name: 'm',
    createdAt: 1,
    classifierStatus: { ...idleStatus(), state, processedThrough: 4 },
  })
  return { db, runInTransaction }
}

function livePass(): RunState {
  return {
    runId: 'run_pass',
    kind: PERIODIC_CLASSIFIER_KIND,
    gateBehavior: 'hard-gate',
    interruptible: 'pass',
    beforeTurn: false,
    actionId: 'act_pass',
    storyId: 's1',
    branchId: 'b1',
    abortController: new AbortController(),
    currentPhase: 'classify',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  }
}

describe('runClassifierNow', () => {
  beforeEach(() => {
    ensurePeriodicClassifierPipelineRegistered.mockReset()
    runPipeline.mockReset()
    currentStoryStore.__reset()
    generationStore.__reset()
  })
  afterEach(() => {
    currentStoryStore.__reset()
    generationStore.__reset()
  })

  function openB1(): void {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition: DEFINITION,
      settings: SETTINGS,
    })
  }

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

  // classifier.md → Failure policy: a pass over a held branch would re-read writes still on disk.
  it('refuses a branch held running without starting a run', async () => {
    openB1()
    const ctx = await seedBranch('running')

    const result = await runClassifierNow('b1', ctx)

    expect(result).toEqual({ outcome: 'rejected', blockedBy: 'classifier-held' })
    expect(ensurePeriodicClassifierPipelineRegistered).not.toHaveBeenCalled()
    expect(runPipeline).not.toHaveBeenCalled()
  })

  // classifier.md → Manual override: enabled in failed, the retry without a turn.
  it('starts a pass on a failed branch', async () => {
    openB1()
    const ctx = await seedBranch('failed')
    runPipeline.mockResolvedValue({ outcome: 'completed' })

    expect(await runClassifierNow('b1', ctx)).toEqual({ outcome: 'completed' })
    expect(runPipeline).toHaveBeenCalledTimes(1)
  })

  it('hands a running branch whose pass is live to runPipeline, whose own rule refuses it', async () => {
    openB1()
    const ctx = await seedBranch('running')
    generationStore.startRun(livePass())
    runPipeline.mockResolvedValue({ outcome: 'rejected', blockedBy: PERIODIC_CLASSIFIER_KIND })

    const result = await runClassifierNow('b1', ctx)

    expect(runPipeline).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ outcome: 'rejected', blockedBy: PERIODIC_CLASSIFIER_KIND })
  })
})
