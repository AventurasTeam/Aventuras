import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { pipelineRuns, storyDefinitionSchema, storyEntries, storySettingsSchema } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { CLASSIFIER_HELD } from '@/lib/pipeline'
import { makeHarness, resetSingletons } from '@/lib/pipeline/__tests__/harness'
import { runClassifierPass as startPass } from '@/lib/pipeline/definitions/classifier-pass'
import { currentStoryStore, generationStore } from '@/lib/stores'

import { runClassifierNow } from './run-now'
import { registerStandInClose } from '../turns/__tests__/stand-in-close'
import { registerStandInPass } from '../turns/__tests__/stand-in-pass'

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

  it('refuses while an embedder swap is pending, as a close does', async () => {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition: DEFINITION,
      settings: { ...SETTINGS, embedding_swap_target: 'next-model' },
    })
    const { db, runInTransaction } = await createTestDb()

    const result = await runClassifierNow('b1', { db, runInTransaction })

    expect(result).toEqual({ outcome: 'rejected', blockedBy: 'embedder-swap' })
    expect(runClassifierPass).not.toHaveBeenCalled()
  })

  // Exact arguments: a `beforeTurn` anywhere would show Run now's pass as Send's, and without
  // `alone` its pass would chain an owed close under Retry's hold.
  it('starts the pass alone on the open story’s branch, never as Send’s', async () => {
    open('b1')
    const { db, runInTransaction } = await createTestDb()
    runClassifierPass.mockResolvedValue({ outcome: 'completed' })

    const result = await runClassifierNow('b1', { db, runInTransaction })

    expect(runClassifierPass.mock.calls).toStrictEqual([
      [{ storyId: 's1', branchId: 'b1' }, { db, runInTransaction }, { alone: true }],
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

// classifier.md → Failure policy: Retry and Run now run the pass alone; an owed close waits for Send.
describe('runClassifierNow with a close owed', () => {
  beforeEach(() => {
    resetSingletons()
    runClassifierPass.mockImplementation(startPass)
  })
  afterEach(() => {
    runClassifierPass.mockReset()
    resetSingletons()
  })

  it('commits the pass and chains no close', async () => {
    const { db, ctx } = await makeHarness()
    const kinds = ['opening', 'user_action', 'ai_reply'] as const
    await db.insert(storyEntries).values(
      kinds.map((kind, i) => ({
        id: `e${i + 1}`,
        branchId: 'b1',
        position: i + 1,
        kind,
        content: `entry ${i + 1}`,
        createdAt: i + 1,
      })),
    )
    open('b1')
    const pass = registerStandInPass({ anchorEntryId: null })
    const close = registerStandInClose()
    // A pick on the reply owes the close. A close chained here would hold on it, so it is let go
    // to end the chain on the assertions below rather than the timeout.
    generationStore.setPendingClose('b1', { endEntryId: 'e3' })
    void close.nextHeld().then((chained) => chained.finish('failed'))

    const running = runClassifierNow('b1', { db, runInTransaction: ctx.runInTransaction })
    const held = await pass.nextHeld()
    held.finish('completed')

    expect(await running).toMatchObject({ outcome: 'completed' })
    expect(close.runs).toEqual([])
    expect(await db.select({ kind: pipelineRuns.kind }).from(pipelineRuns)).toEqual([
      { kind: PERIODIC_CLASSIFIER_KIND },
    ])
  })
})
