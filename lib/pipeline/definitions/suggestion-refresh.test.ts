import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { APP_SETTINGS_DEFAULTS, STORY_SETTINGS_DEFAULTS, type StorySettings } from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'
import { runPreflight } from '@/lib/pipeline/runtime/preflight'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '@/lib/pipeline/types'
import {
  appSettingsStore,
  currentStoryStore,
  entitiesStore,
  entriesStore,
  isUserEditBlocked,
  resetAllStores,
} from '@/lib/stores'

import { createPhaseDb, hydrateEntries, resetPhaseDb } from './__tests__/phase-db'
import { ensurePerTurnPipelineRegistered, PER_TURN_KIND } from './per-turn'
import { fallbackClassifierWithSuggestionsSchema } from './per-turn-piggyback'
import {
  ensureSuggestionRefreshPipelineRegistered,
  SUGGESTION_EMISSION_PHASE,
  SUGGESTION_REFRESH_KIND,
  SUGGESTION_TRANSLATION_PHASE,
  suggestionRefreshSchema,
  SUGGESTIONS_UNUSABLE,
  type SuggestionRefreshInput,
} from './suggestion-refresh'
import { __resetRegistry, getPipeline } from '../authoring/registry'
import { checkConcurrencyContract } from '../runtime/concurrency'

const definition = {
  mode: 'adventure' as const,
  leadEntityId: null,
  narration: 'first' as const,
  genre: { label: 'Fantasy', promptBody: 'High fantasy.' },
  tone: { label: 'Wry', promptBody: '' },
  setting: 'A keep on a hill.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
}

function baseSettings(overrides: Partial<StorySettings> = {}): StorySettings {
  return { ...STORY_SETTINGS_DEFAULTS, ...overrides }
}

const SUGGESTION_CATEGORIES = [
  { id: 'cat_action', label: 'Action', promptHint: 'act', color: 'red', enabled: true, order: 0 },
  {
    id: 'cat_dialogue',
    label: 'Dialogue',
    promptHint: 'say',
    color: 'blue',
    enabled: true,
    order: 1,
  },
]

const provider = {
  id: 'prov-1',
  type: 'anthropic' as const,
  displayName: 'Anthropic',
  apiKey: 'key',
  favoriteModelIds: [],
}

const { generateStructuredMock } = vi.hoisted(() => ({ generateStructuredMock: vi.fn() }))

vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, generateStructured: generateStructuredMock }
})

const TARGET_ENTRY = {
  id: 'entry-1',
  branchId: 'b1',
  position: 1,
  kind: 'ai_reply',
  content: 'The gate groans open.',
  chapterId: null,
  metadata: {
    sceneEntities: [],
    currentLocationId: null,
    worldTime: 120,
    model: 'model-1',
  },
  createdAt: 0,
}

function openStory(settings: Partial<StorySettings> = {}) {
  currentStoryStore.set({
    storyId: 's1',
    branchId: 'b1',
    definition,
    settings: baseSettings({
      suggestionsEnabled: true,
      suggestionCount: 2,
      suggestionCategories: SUGGESTION_CATEGORIES,
      ...settings,
    }),
  })
}

function hydrate(entries: unknown[] = [TARGET_ENTRY]) {
  hydrateEntries(phaseDb, 'b1', entries as never[])
  entitiesStore.hydrate('b1', [])
}

function wireAppSettings() {
  vi.spyOn(appSettingsStore, 'getAppSettings').mockReturnValue({
    ...APP_SETTINGS_DEFAULTS,
    providers: [provider],
    profiles: [
      {
        id: 'prof-suggestion',
        kind: 'agent',
        name: 'Suggestion',
        modelRef: { providerId: provider.id, modelId: 'sug-model' },
      },
    ],
    assignments: { suggestion: 'prof-suggestion' },
    defaultProviderId: provider.id,
  } as never)
}

function phaseCtx(inputs: unknown, abortSignal = new AbortController().signal): PhaseContext {
  return {
    actionId: 'act_1',
    abortSignal,
    intermediates: {},
    inputs,
    log: makeLogger('act_1'),
    db: phaseDb.db,
    runInTransaction: async () => undefined,
    storyId: 's1',
    branchId: 'b1',
  }
}

async function drain(gen: AsyncGenerator<PhaseEmittedEvent, PhaseResult>) {
  const events: PhaseEmittedEvent[] = []
  let next = await gen.next()
  while (!next.done) {
    events.push(next.value)
    next = await gen.next()
  }
  return { events, result: next.value }
}

function emissionPhase() {
  ensureSuggestionRefreshPipelineRegistered()
  const node = getPipeline(SUGGESTION_REFRESH_KIND).phases[0]
  if (!node || !('run' in node)) throw new Error('expected a single-run emission phase node')
  return node.run
}

const DEFAULT_INPUT: SuggestionRefreshInput = { refreshGuidance: '' }

async function runEmission(inputs: unknown = DEFAULT_INPUT, abortSignal?: AbortSignal) {
  return drain(emissionPhase()(phaseCtx(inputs, abortSignal)))
}

function okChips(suggestions: { categoryRef: string; text: string }[]) {
  return { status: 'ok', value: { suggestions } }
}

beforeEach(() => {
  vi.restoreAllMocks()
  generateStructuredMock.mockReset()
  __resetRegistry()
  resetAllStores()
  resetPhaseDb(phaseDb)
})

let phaseDb: Awaited<ReturnType<typeof createPhaseDb>>

beforeAll(async () => {
  phaseDb = await createPhaseDb()
})

describe('suggestion-refresh declaration', () => {
  it('matches the canonical V1 declaration: hard-gate, self-blocking, pill-only, two phases', () => {
    ensureSuggestionRefreshPipelineRegistered()
    const p = getPipeline(SUGGESTION_REFRESH_KIND)

    expect(p.phases.map((n) => n.name)).toEqual([
      SUGGESTION_EMISSION_PHASE,
      SUGGESTION_TRANSLATION_PHASE,
    ])
    expect(p.affordance).toBe('pill-only')
    // hard-gate is what makes undo / redo / edit / rollback reject for this
    // run's duration; without it the chips can outlive the context they
    // describe, and the post-call re-read only proves the target still exists.
    expect(p.gateBehavior).toBe('hard-gate')
    expect(p.concurrencyPolicy.blockedBy).toEqual(['per-turn', 'suggestion-refresh'])
    expect(p.chainsTo).toBeUndefined()
  })

  it('holds the reader edit gate while running, so a reversal cannot race the write', () => {
    ensureSuggestionRefreshPipelineRegistered()
    // Reads gateBehavior off the registered pipeline rather than restating it,
    // so this fails alongside the declaration if the kind is ever relaxed —
    // the point is the consequence, not the literal.
    const { gateBehavior } = getPipeline(SUGGESTION_REFRESH_KIND)
    const running = {
      runs: new Map([['run-1', { runId: 'run-1', kind: SUGGESTION_REFRESH_KIND, gateBehavior }]]),
      reversalInProgress: false,
    }
    expect(isUserEditBlocked(running as never)).toBe(true)
  })

  it('yields to per-turn so a turn never waits on a refresh whose chips it orphans', () => {
    ensureSuggestionRefreshPipelineRegistered()
    ensurePerTurnPipelineRegistered()
    const refresh = getPipeline(SUGGESTION_REFRESH_KIND)

    expect(refresh.concurrencyPolicy.yieldsTo).toEqual([PER_TURN_KIND])
    // The other direction must stay open, or the yield never fires: a per-turn
    // that blocks on a running refresh is rejected before it can pre-empt it,
    // and the reader turns a rejected turn into a system failure entry.
    expect(getPipeline(PER_TURN_KIND).concurrencyPolicy.blockedBy).not.toContain(
      SUGGESTION_REFRESH_KIND,
    )
  })

  it('resolves a collision by aborting the refresh, not by rejecting the turn', () => {
    ensureSuggestionRefreshPipelineRegistered()
    ensurePerTurnPipelineRegistered()
    const running = new Map([['run-1', { runId: 'run-1', kind: SUGGESTION_REFRESH_KIND } as never]])

    expect(checkConcurrencyContract(PER_TURN_KIND, running, false)).toEqual({
      kind: 'start-after-yields',
      targets: ['run-1'],
    })
  })

  it('declares the suggestion agent as phase 0 resolver input and nothing for translation', () => {
    ensureSuggestionRefreshPipelineRegistered()
    const [emission, translation] = getPipeline(SUGGESTION_REFRESH_KIND).phases
    expect(emission && 'resolves' in emission ? emission.resolves : undefined).toEqual([
      { target: 'suggestion' },
    ])
    expect(translation).not.toHaveProperty('resolves')
  })

  it('registers idempotently — a second ensure() call does not re-register', () => {
    ensureSuggestionRefreshPipelineRegistered()
    const first = getPipeline(SUGGESTION_REFRESH_KIND)
    expect(() => ensureSuggestionRefreshPipelineRegistered()).not.toThrow()
    expect(getPipeline(SUGGESTION_REFRESH_KIND)).toBe(first)
  })

  it('pre-flight halts the pipeline when the suggestion agent has no assignment', () => {
    ensureSuggestionRefreshPipelineRegistered()
    const snapshot = {
      appSettings: {
        ...APP_SETTINGS_DEFAULTS,
        providers: [provider],
        profiles: [],
        assignments: {},
        defaultProviderId: provider.id,
      },
      storySettings: baseSettings(),
    }
    expect(runPreflight(getPipeline(SUGGESTION_REFRESH_KIND), snapshot as never)).toEqual({
      kind: 'config-resolver',
      failure: 'no-profile-assigned',
      target: 'suggestion',
      phaseName: SUGGESTION_EMISSION_PHASE,
    })
  })

  it('pre-flight passes once the suggestion agent resolves', () => {
    ensureSuggestionRefreshPipelineRegistered()
    const snapshot = {
      appSettings: {
        ...APP_SETTINGS_DEFAULTS,
        providers: [provider],
        profiles: [
          {
            id: 'prof-suggestion',
            kind: 'agent',
            name: 'Suggestion',
            modelRef: { providerId: provider.id, modelId: 'sug-model' },
          },
        ],
        assignments: { suggestion: 'prof-suggestion' },
        defaultProviderId: provider.id,
      },
      storySettings: baseSettings(),
    }
    expect(runPreflight(getPipeline(SUGGESTION_REFRESH_KIND), snapshot as never)).toBeNull()
  })
})

describe('suggestionRefreshSchema', () => {
  const malformed = { suggestions: [{ categoryRef: 'cat1' }, 'not an object'] }

  it('fails the parse on a malformed suggestions array', () => {
    // Deliberately no .catch([]): chips are this call's only output, so a bad
    // array must reach callWithRetry's re-ask and then the strip's error state.
    // With .catch the parse SUCCEEDS as [] and the phase completes silently —
    // every phase test mocks generateStructured, so nothing else pins this.
    expect(suggestionRefreshSchema.safeParse(malformed).success).toBe(false)
  })

  it('is deliberately asymmetric with the classifier fold, which degrades to []', () => {
    const parsed = fallbackClassifierWithSuggestionsSchema.safeParse({
      sceneEntities: [],
      worldTimeDelta: 0,
      ...malformed,
    })
    // There, .catch protects the sibling scene-state fields from a bad array.
    expect(parsed.success).toBe(true)
    expect(parsed.data?.suggestions).toEqual([])
  })
})

describe('suggestion-refresh translation phase', () => {
  it('short-circuits in M3: yields nothing, completes', async () => {
    ensureSuggestionRefreshPipelineRegistered()
    openStory()
    const node = getPipeline(SUGGESTION_REFRESH_KIND).phases[1]
    if (!node || !('run' in node)) throw new Error('expected a single-run translation phase node')
    const first = await node.run(phaseCtx(undefined)).next()
    expect(first).toEqual({ done: true, value: { status: 'completed' } })
  })
})

describe('suggestion-refresh emission phase', () => {
  it('fails without ever calling the model when the run carries no refresh input', async () => {
    openStory()
    hydrate()
    wireAppSettings()

    // Not runEmission(undefined) — that would fall back to its default input.
    const { result } = await drain(emissionPhase()(phaseCtx(undefined)))

    expect(result).toEqual({
      status: 'failed',
      error: {
        kind: 'phase-logic',
        detail: 'suggestion-refresh: run started without a refresh input',
        phaseName: SUGGESTION_EMISSION_PHASE,
      },
    })
    expect(generateStructuredMock).not.toHaveBeenCalled()
  })

  it('rejects an open story from a different story on the same branch', async () => {
    currentStoryStore.set({
      storyId: 's2',
      branchId: 'b1',
      definition,
      settings: baseSettings({ suggestionCategories: SUGGESTION_CATEGORIES }),
    })
    hydrate()

    const { result } = await runEmission()

    expect(result).toEqual({
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'suggestion-refresh: no open story for branch' },
    })
    expect(generateStructuredMock).not.toHaveBeenCalled()
  })

  it('fails when the entries store is loaded for another branch', async () => {
    openStory()
    hydrateEntries(phaseDb, 'b-other', [])
    entitiesStore.hydrate('b1', [])

    const { result } = await runEmission()

    expect(result).toEqual({
      status: 'failed',
      error: {
        kind: 'orchestrator',
        detail: 'suggestion-refresh: entries store loaded for another branch',
      },
    })
    expect(generateStructuredMock).not.toHaveBeenCalled()
  })

  it('no-ops without calling the model when every category is disabled', async () => {
    openStory({
      suggestionCategories: SUGGESTION_CATEGORIES.map((c) => ({ ...c, enabled: false })),
    })
    hydrate()

    const { events, result } = await runEmission()

    expect(result).toEqual({ status: 'completed' })
    expect(events).toEqual([])
    expect(generateStructuredMock).not.toHaveBeenCalled()
  })

  it('no-ops without calling the model when suggestions are disabled for the story', async () => {
    openStory({ suggestionsEnabled: false })
    hydrate()

    const { events, result } = await runEmission()

    expect(result).toEqual({ status: 'completed' })
    expect(events).toEqual([])
    expect(generateStructuredMock).not.toHaveBeenCalled()
  })

  it('completes without a call when the branch has no narrative entry to anchor to', async () => {
    openStory()
    hydrate([{ ...TARGET_ENTRY, id: 'entry-system', kind: 'system' }])
    wireAppSettings()

    const { events, result } = await runEmission()

    expect(result).toEqual({ status: 'completed' })
    expect(events).toEqual([])
    // Resolved before the call, so an unanchorable run never spends a token.
    expect(generateStructuredMock).not.toHaveBeenCalled()
  })

  it('anchors past a user_action tail to the last AI-authored entry', async () => {
    openStory()
    // Mid-turn: the action has committed, the reply has not. Anchoring here
    // would blank the strip to ⟳ Generate while generation is already running.
    hydrate([
      TARGET_ENTRY,
      { ...TARGET_ENTRY, id: 'entry-action', position: 2, kind: 'user_action', content: 'I run.' },
    ])
    wireAppSettings()
    generateStructuredMock.mockResolvedValue(okChips([{ categoryRef: 'cat1', text: 'Draw.' }]))

    const { events } = await runEmission()

    expect(events[0]).toMatchObject({ entryId: 'entry-1' })
  })

  it('anchors past a system tail to the last narrative entry', async () => {
    openStory()
    // A failed turn's system entry is the branch tail; clearSystemEntry deletes
    // that row on Retry / Dismiss / next Send, so chips anchored there could
    // never survive the way out of the failure.
    const systemTail = {
      ...TARGET_ENTRY,
      id: 'entry-system',
      position: 2,
      kind: 'system',
      content: 'THE TURN FAILED.',
    }
    hydrate([TARGET_ENTRY, systemTail])
    wireAppSettings()
    generateStructuredMock.mockResolvedValue(okChips([{ categoryRef: 'cat1', text: 'Draw.' }]))

    const { events } = await runEmission()

    expect(events[0]).toMatchObject({ entryId: 'entry-1' })
    const prompt = generateStructuredMock.mock.calls[0]?.[1] as string
    expect(prompt).not.toContain('THE TURN FAILED.')
  })

  it('calls the dedicated suggestion agent with the refresh template and story model overrides', async () => {
    openStory({ models: { suggestion: 'story-model' } })
    hydrate()
    wireAppSettings()
    generateStructuredMock.mockResolvedValue(okChips([{ categoryRef: 'cat1', text: 'Draw.' }]))

    await runEmission()

    expect(generateStructuredMock).toHaveBeenCalledWith(
      'suggestion',
      expect.any(String),
      suggestionRefreshSchema,
      expect.objectContaining({ storyModels: { suggestion: 'story-model' } }),
      expect.anything(),
    )
    const prompt = generateStructuredMock.mock.calls[0]?.[1] as string
    expect(prompt).toContain('A keep on a hill.')
    expect(prompt).toContain('The gate groans open.')
    expect(prompt).toContain('id "cat1" = Action')
    expect(prompt).toContain('id "cat2" = Dialogue')
    // Structured call: it must ask for the JSON field, never the tagged block
    // the narrative fold's shared macro instructs.
    expect(prompt).toContain('"suggestions" field')
    expect(prompt).not.toContain('<suggestions>')
  })

  it('threads composer text into the prompt as refresh guidance and persists it', async () => {
    openStory()
    hydrate()
    wireAppSettings()
    generateStructuredMock.mockResolvedValue(okChips([{ categoryRef: 'cat1', text: 'Draw.' }]))

    const { events } = await runEmission({
      refreshGuidance: 'I want to sneak around the back',
    })

    const prompt = generateStructuredMock.mock.calls[0]?.[1] as string
    expect(prompt).toContain('I want to sneak around the back')
    expect(events[0]).toMatchObject({
      action: {
        payload: {
          metadata: {
            nextTurnSuggestions: expect.objectContaining({
              refreshGuidance: 'I want to sneak around the back',
            }),
          },
        },
      },
    })
  })

  it('omits refreshGuidance from metadata and prompt when the composer was empty', async () => {
    openStory()
    hydrate()
    wireAppSettings()
    generateStructuredMock.mockResolvedValue(okChips([{ categoryRef: 'cat1', text: 'Draw.' }]))

    const { events } = await runEmission({ refreshGuidance: '   ' })

    const prompt = generateStructuredMock.mock.calls[0]?.[1] as string
    expect(prompt).not.toContain('already started writing')
    const event = events[0]
    if (
      !event ||
      event.type !== 'delta_emitted' ||
      event.action.kind !== 'updateStoryEntryMetadata'
    )
      throw new Error('expected an updateStoryEntryMetadata delta')
    expect(event.action.payload.metadata.nextTurnSuggestions).not.toHaveProperty('refreshGuidance')
  })

  it('writes one metadata delta anchored to the target entry, preserving its other metadata', async () => {
    openStory()
    hydrate()
    wireAppSettings()
    generateStructuredMock.mockResolvedValue(
      okChips([
        { categoryRef: 'cat1', text: 'Draw the blade.' },
        { categoryRef: 'cat2', text: '"Who sent you?"' },
      ]),
    )

    const { events, result } = await runEmission()

    expect(result).toEqual({ status: 'completed' })
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: 'delta_emitted',
      entryId: 'entry-1',
      action: {
        kind: 'updateStoryEntryMetadata',
        source: 'ai_classifier',
        payload: {
          branchId: 'b1',
          id: 'entry-1',
          metadata: {
            sceneEntities: [],
            currentLocationId: null,
            worldTime: 120,
            model: 'model-1',
            nextTurnSuggestions: {
              items: [
                { categoryId: 'cat_action', text: 'Draw the blade.' },
                { categoryId: 'cat_dialogue', text: '"Who sent you?"' },
              ],
              source: 'refresh',
            },
          },
        },
      },
    })
  })

  it('builds a metadata floor for a legacy target entry that carries none', async () => {
    openStory()
    // Legacy, not system: system targets are refused outright above, so the
    // floor exists for rows written before the metadata column carried a scene.
    hydrate([{ ...TARGET_ENTRY, metadata: null }])
    wireAppSettings()
    generateStructuredMock.mockResolvedValue(okChips([{ categoryRef: 'cat1', text: 'Draw.' }]))

    const { events } = await runEmission()

    const event = events[0]
    if (
      !event ||
      event.type !== 'delta_emitted' ||
      event.action.kind !== 'updateStoryEntryMetadata'
    )
      throw new Error('expected an updateStoryEntryMetadata delta')
    expect(event.action.payload.metadata).toEqual({
      sceneEntities: [],
      currentLocationId: null,
      worldTime: 0,
      nextTurnSuggestions: {
        items: [{ categoryId: 'cat_action', text: 'Draw.' }],
        source: 'refresh',
      },
    })
  })

  it('drops chips whose category ref never resolved and clamps the rest to suggestionCount', async () => {
    openStory({ suggestionCount: 2 })
    hydrate()
    wireAppSettings()
    generateStructuredMock.mockResolvedValue(
      okChips([
        { categoryRef: 'cat9', text: 'Invented category.' },
        { categoryRef: 'cat1', text: 'One.' },
        { categoryRef: 'cat2', text: 'Two.' },
        { categoryRef: 'cat1', text: 'Three.' },
      ]),
    )

    const { events } = await runEmission()

    const event = events[0]
    if (
      !event ||
      event.type !== 'delta_emitted' ||
      event.action.kind !== 'updateStoryEntryMetadata'
    )
      throw new Error('expected an updateStoryEntryMetadata delta')
    expect(event.action.payload.metadata.nextTurnSuggestions?.items).toEqual([
      { categoryId: 'cat_action', text: 'One.' },
      { categoryId: 'cat_dialogue', text: 'Two.' },
    ])
  })

  // An unresolvable ref is the likeliest model failure (it echoes the category
  // label instead of the opaque cat1), so it must not read as a completed run —
  // that left ⟳ pixel-identical to never having been pressed.
  it('fails without a write when nothing resolved', async () => {
    openStory()
    hydrate()
    wireAppSettings()
    generateStructuredMock.mockResolvedValue(okChips([{ categoryRef: 'cat9', text: 'Nope.' }]))

    const { events, result } = await runEmission()

    expect(result).toMatchObject({
      status: 'failed',
      error: { kind: 'phase-logic', subsystem: SUGGESTIONS_UNUSABLE },
    })
    expect(events).toEqual([])
  })

  it('fails without a write when the model returns an empty array', async () => {
    openStory()
    hydrate()
    wireAppSettings()
    generateStructuredMock.mockResolvedValue(okChips([]))

    const { events, result } = await runEmission()

    expect(result).toMatchObject({
      status: 'failed',
      error: { kind: 'phase-logic', subsystem: SUGGESTIONS_UNUSABLE },
    })
    expect(events).toEqual([])
  })

  it('completes without a write when a reversal deletes the target during the call', async () => {
    openStory()
    hydrate()
    wireAppSettings()
    // The hard gate rejects a user reversal for this run's duration, but abort
    // paths and non-UI writers sit outside it, so the row can still be gone by
    // the time the call returns.
    generateStructuredMock.mockImplementation(async () => {
      hydrateEntries(phaseDb, 'b1', [])
      return okChips([{ categoryRef: 'cat1', text: 'Orphaned.' }])
    })

    const { events, result } = await runEmission()

    expect(result).toEqual({ status: 'completed' })
    expect(events).toEqual([])
  })

  it('writes over the row as it stands after the call, not the pre-call snapshot', async () => {
    openStory()
    hydrate()
    wireAppSettings()
    generateStructuredMock.mockImplementation(async () => {
      entriesStore.patch('b1', {
        op: 'update',
        id: 'entry-1',
        columns: { metadata: { ...TARGET_ENTRY.metadata, worldTime: 999 } },
      })
      return okChips([{ categoryRef: 'cat1', text: 'Draw.' }])
    })

    const { events } = await runEmission()

    const event = events[0]
    if (
      !event ||
      event.type !== 'delta_emitted' ||
      event.action.kind !== 'updateStoryEntryMetadata'
    )
      throw new Error('expected an updateStoryEntryMetadata delta')
    expect(event.action.payload.metadata.worldTime).toBe(999)
  })

  it('discards the result when a cancel lands while the model call is in flight', async () => {
    openStory()
    hydrate()
    wireAppSettings()
    const controller = new AbortController()
    // The provider call resolves normally and the cancel lands in the window
    // between its return and the write (generation-pipeline.md → Abort).
    generateStructuredMock.mockImplementation(async () => {
      controller.abort()
      return okChips([{ categoryRef: 'cat1', text: 'Too late.' }])
    })

    const { events, result } = await runEmission({ refreshGuidance: '' }, controller.signal)

    expect(result).toEqual({ status: 'aborted' })
    expect(events).toEqual([])
  })

  it('returns aborted when cancel lands while the yielded delta is being applied', async () => {
    openStory()
    hydrate()
    wireAppSettings()
    const controller = new AbortController()
    generateStructuredMock.mockResolvedValue(okChips([{ categoryRef: 'cat1', text: 'Too late.' }]))
    const gen = emissionPhase()(phaseCtx(DEFAULT_INPUT, controller.signal))

    const emitted = await gen.next()
    expect(emitted.done).toBe(false)
    expect(emitted.value).toMatchObject({ type: 'delta_emitted' })

    controller.abort()
    expect(await gen.next()).toEqual({ done: true, value: { status: 'aborted' } })
  })

  it('reports an aborted provider call as aborted, not failed', async () => {
    openStory()
    hydrate()
    wireAppSettings()
    generateStructuredMock.mockResolvedValue({ status: 'aborted' })

    const { events, result } = await runEmission()

    expect(result).toEqual({ status: 'aborted' })
    expect(events).toEqual([])
  })

  it('surfaces a resolver race as a config-resolver failure naming the suggestion agent', async () => {
    openStory()
    hydrate()
    wireAppSettings()
    generateStructuredMock.mockResolvedValue({
      status: 'not-configured',
      kind: 'profile-missing',
    })

    const { events, result } = await runEmission()

    expect(result).toEqual({
      status: 'failed',
      error: {
        kind: 'config-resolver',
        failure: 'profile-missing',
        target: 'suggestion',
        phaseName: SUGGESTION_EMISSION_PHASE,
      },
    })
    expect(events).toEqual([])
  })

  it('surfaces an exhausted provider call as a failure so the strip can show Retry', async () => {
    openStory()
    hydrate()
    wireAppSettings()
    generateStructuredMock.mockResolvedValue({ status: 'failed', detail: 'boom' })

    const { events, result } = await runEmission()

    expect(result).toEqual({
      status: 'failed',
      error: { kind: 'provider', reason: 'unknown', detail: 'boom' },
    })
    expect(events).toEqual([])
  })

  it('anchors to the branch tail and prompts with the whole loaded branch', async () => {
    openStory()
    hydrate([
      TARGET_ENTRY,
      { ...TARGET_ENTRY, id: 'entry-2', position: 2, content: 'THE LATEST TURN.' },
    ])
    wireAppSettings()
    generateStructuredMock.mockResolvedValue(okChips([{ categoryRef: 'cat1', text: 'Draw.' }]))

    const { events } = await runEmission()

    // No caller-supplied target to truncate at any more: the anchor is the tail
    // by construction, so the whole branch is the window and recency windowing
    // is the template's `recent` filter.
    const prompt = generateStructuredMock.mock.calls[0]?.[1] as string
    expect(prompt).toContain('The gate groans open.')
    expect(prompt).toContain('THE LATEST TURN.')
    expect(events[0]).toMatchObject({ entryId: 'entry-2' })
  })
})
