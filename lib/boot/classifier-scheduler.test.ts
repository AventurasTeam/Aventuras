import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  embedClassifierDescriptions,
  headPosition,
  readClassifierStatus,
  runClassifierNow,
} from '@/lib/actions'
import { idleStatus } from '@/lib/classifier'
import { storyDefinitionSchema, storySettingsSchema, type DbCtx } from '@/lib/db'
import { configureClassifierEmbedder, PER_TURN_KIND, pipelineEventBus } from '@/lib/pipeline'
import { currentStoryStore, resetAllStores } from '@/lib/stores'

import { wireClassifierScheduler } from './bootstrap'

// Spied (call-through by default) so wireClassifierScheduler's real composition
// is exercised; individual tests override return values for determinism.
vi.mock('@/lib/actions', { spy: true })
vi.mock('@/lib/pipeline', { spy: true })

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
  classifierCadence: 1,
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

const ctx: DbCtx = { db: {} as DbCtx['db'], runInTransaction: vi.fn() }

describe('wireClassifierScheduler', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetAllStores()
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition: DEFINITION,
      settings: SETTINGS,
    })
    vi.mocked(headPosition).mockResolvedValue(5)
    vi.mocked(readClassifierStatus).mockResolvedValue(idleStatus())
    vi.mocked(runClassifierNow).mockResolvedValue({
      outcome: 'completed',
      runId: 'r',
      actionId: 'a',
    })
  })
  afterEach(() => resetAllStores())

  it('wires the embedder composition at boot', () => {
    wireClassifierScheduler(ctx)
    expect(configureClassifierEmbedder).toHaveBeenCalledWith(embedClassifierDescriptions)
  })

  it('ticks only for a successfully-completed per-turn run, not the classifier itself', async () => {
    wireClassifierScheduler(ctx)

    pipelineEventBus.emit({
      type: 'run_complete',
      runId: 'r1',
      kind: 'periodic-classifier',
      actionId: 'a1',
      outcome: 'completed',
    })
    await Promise.resolve()
    expect(runClassifierNow).not.toHaveBeenCalled()

    pipelineEventBus.emit({
      type: 'run_complete',
      runId: 'r2',
      kind: PER_TURN_KIND,
      actionId: 'a2',
      outcome: 'aborted',
    })
    await Promise.resolve()
    expect(runClassifierNow).not.toHaveBeenCalled()

    pipelineEventBus.emit({
      type: 'run_complete',
      runId: 'r3',
      kind: PER_TURN_KIND,
      actionId: 'a3',
      outcome: 'completed',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(runClassifierNow).toHaveBeenCalledWith('b1', ctx)
  })

  it('re-wiring tears down the prior subscription instead of leaking a second one', async () => {
    wireClassifierScheduler(ctx)
    wireClassifierScheduler(ctx)

    pipelineEventBus.emit({
      type: 'run_complete',
      runId: 'r1',
      kind: PER_TURN_KIND,
      actionId: 'a1',
      outcome: 'completed',
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(runClassifierNow).toHaveBeenCalledTimes(1)
  })
})
