import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  STORY_SETTINGS_DEFAULTS,
  type Entity,
  type EntryMetadata,
  type Story,
  type StoryEntry,
  type StorySettings,
} from '@/lib/db'
import type { Logger } from '@/lib/diagnostics'
import type { RankedType, RetrievalOutcome, RetrievalParams, RetrievalType } from '@/lib/retrieval'
import {
  currentStoryStore,
  entitiesStore,
  entriesStore,
  resetAllStores,
  storiesStore,
} from '@/lib/stores'

import { ensurePerTurnPipelineRegistered, PER_TURN_KIND } from './per-turn'
import { RETRIEVAL_INTERMEDIATE_KEY, RETRIEVAL_PHASE_NAME } from './per-turn-retrieval'
import { getPipeline } from '../authoring/registry'
import type { PhaseEmittedEvent, PhaseResult } from '../types'

const { runRetrievalMock } = vi.hoisted(() => ({ runRetrievalMock: vi.fn() }))

vi.mock('@/lib/retrieval', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, runRetrieval: runRetrievalMock }
})

const definition = {
  mode: 'adventure' as const,
  leadEntityId: 'char_hero',
  narration: 'first' as const,
  genre: { label: 'Fantasy', promptBody: 'High fantasy.' },
  tone: { label: 'Wry', promptBody: 'Dry humor.' },
  setting: 'A keep on a hill.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
}

const EMPTY_BUNDLE: RankedType = {
  selected: [],
  traces: [],
  funnel: {
    poolSize: 0,
    preFilteredSize: 0,
    mmrSize: 0,
    selectedCount: 0,
    tokensUsed: 0,
    typeBudget: 0,
  },
}

function okOutcome(
  staleCounts: Record<RetrievalType, number> = {
    entities: 0,
    lore: 0,
    happenings: 0,
    threads: 0,
    chapters: 0,
  },
): Extract<RetrievalOutcome, { ok: true }> {
  return {
    ok: true,
    floor: {
      sceneEntities: [],
      currentLocation: null,
      activeThreads: [],
      alwaysEntities: [],
      alwaysLore: [],
      alwaysThreads: [],
      seatedIds: new Set<string>(),
    },
    bundles: {
      entities: EMPTY_BUNDLE,
      lore: EMPTY_BUNDLE,
      happenings: EMPTY_BUNDLE,
      threads: EMPTY_BUNDLE,
      chapters: EMPTY_BUNDLE,
    },
    queries: {
      q1: { text: '', source: 'user_action' },
      q2: { text: '', source: 'structural_digest' },
      q3: { text: '', source: 'prose_extract' },
      presence: [false, false, false],
      embedTexts: [],
    },
    staleCounts,
    injectedAwarenessIds: ['haw_1'],
  }
}

const OK_OUTCOME = okOutcome()

function storyRow(settings: StorySettings, id = 's1'): Story {
  return {
    id,
    title: 'A story',
    description: null,
    tags: [],
    coverAssetId: null,
    accentColor: null,
    status: 'active',
    favorite: 0,
    lastOpenedAt: null,
    definition,
    settings,
    createdAt: 1,
    updatedAt: 1,
    currentBranchId: 'b1',
  }
}

function entry(
  position: number,
  kind: StoryEntry['kind'],
  content: string,
  metadata: EntryMetadata | null = null,
): StoryEntry {
  return {
    id: `entry_${position}`,
    branchId: 'b1',
    position,
    kind,
    content,
    chapterId: null,
    metadata,
    createdAt: position,
  }
}

function meta(overrides: Partial<EntryMetadata> = {}): EntryMetadata {
  return { sceneEntities: [], currentLocationId: null, worldTime: 0, ...overrides }
}

function entity(id: string, kind: Entity['kind'], name: string): Entity {
  return {
    id,
    branchId: 'b1',
    kind,
    name,
    description: null,
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    nameCollisionFlag: 0,
    state: null,
    tags: [],
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

function seedOpenStory(
  opts: {
    settings?: Partial<StorySettings>
    entries?: StoryEntry[]
    entities?: Entity[]
    entriesBranch?: string
    storyId?: string
  } = {},
): StorySettings {
  const settings: StorySettings = { ...STORY_SETTINGS_DEFAULTS, ...opts.settings }
  currentStoryStore.set({
    storyId: opts.storyId ?? 's1',
    branchId: 'b1',
    definition,
    settings,
  })
  entriesStore.hydrate(opts.entriesBranch ?? 'b1', opts.entries ?? [])
  entitiesStore.hydrate('b1', opts.entities ?? [])
  vi.spyOn(storiesStore, 'getStories').mockReturnValue({
    rows: [storyRow(settings, opts.storyId ?? 's1')],
    openFailures: {},
  })
  return settings
}

function openOnBranch(branchId: string): void {
  const open = currentStoryStore.getCurrentStory()
  if (!open) throw new Error('seedOpenStory must run first')
  currentStoryStore.set({ ...open, branchId })
}

async function runRetrievalPhase(abortSignal = new AbortController().signal): Promise<{
  result: PhaseResult
  events: PhaseEmittedEvent[]
  intermediates: Record<string, unknown>
  log: { [K in keyof Logger]: ReturnType<typeof vi.fn> }
}> {
  ensurePerTurnPipelineRegistered()
  const node = getPipeline(PER_TURN_KIND).phases.find((n) => n.name === RETRIEVAL_PHASE_NAME)
  if (!node || !('run' in node)) throw new Error('expected a single-run retrieval phase node')
  const intermediates: Record<string, unknown> = {}
  // A fake logger rather than makeLogger: the real one drops everything when the
  // diagnostics gate is off, which is the default in unit tests.
  const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
  const gen = node.run({
    actionId: 'act_1',
    abortSignal,
    intermediates,
    log,
    db: {} as never,
    storyId: 's1',
    branchId: 'b1',
  })
  const events: PhaseEmittedEvent[] = []
  let next = await gen.next()
  while (!next.done) {
    events.push(next.value)
    next = await gen.next()
  }
  return { result: next.value, events, intermediates, log }
}

function abortedSignal(): AbortSignal {
  const controller = new AbortController()
  controller.abort()
  return controller.signal
}

function lastParams(): RetrievalParams {
  const call = runRetrievalMock.mock.calls.at(-1)
  if (!call) throw new Error('runRetrieval was never called')
  return call[1] as RetrievalParams
}

beforeEach(() => {
  vi.restoreAllMocks()
  runRetrievalMock.mockReset().mockResolvedValue(OK_OUTCOME)
  resetAllStores()
})

describe('per-turn phase order (C6)', () => {
  it('inserts retrieval before narrative and after user-action-translation', () => {
    ensurePerTurnPipelineRegistered()
    const names = getPipeline(PER_TURN_KIND).phases.map((p) => p.name)
    expect(names).toContain(RETRIEVAL_PHASE_NAME)
    expect(names.indexOf(RETRIEVAL_PHASE_NAME)).toBeGreaterThan(
      names.indexOf('user-action-translation'),
    )
    expect(names.indexOf(RETRIEVAL_PHASE_NAME)).toBeLessThan(names.indexOf('narrative'))
  })

  it('leaves the piggyback fallback classifier after narrative', () => {
    ensurePerTurnPipelineRegistered()
    const names = getPipeline(PER_TURN_KIND).phases.map((p) => p.name)
    expect(names.indexOf('narrative')).toBeLessThan(names.indexOf('piggyback-fallback-classifier'))
  })

  it('declares no resolver inputs — retrieval makes no LLM call', () => {
    ensurePerTurnPipelineRegistered()
    const phases = getPipeline(PER_TURN_KIND).phases
    const retrieval = phases.find((p) => p.name === RETRIEVAL_PHASE_NAME)
    const narrative = phases.find((p) => p.name === 'narrative')
    expect(retrieval && 'resolves' in retrieval ? retrieval.resolves : undefined).toBeUndefined()
    // Positive control: `resolves` is a real, populated field on the phases that
    // DO make a call, so the assertion above discriminates rather than reading
    // a key the node shape never carries.
    expect(narrative && 'resolves' in narrative ? narrative.resolves : undefined).toEqual([
      { target: 'narrative' },
    ])
  })
})

describe('retrieval phase — store-desync guards', () => {
  it('fails when no story is open for the run branch', async () => {
    seedOpenStory({ storyId: 's2' })

    const { result } = await runRetrievalPhase()

    expect(result).toEqual({
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'retrieval: no open story for branch' },
    })
    expect(runRetrievalMock).not.toHaveBeenCalled()
  })

  // Distinct from the story mismatch above: the open story is the right STORY on
  // the wrong BRANCH, and every other store here is loaded for the run's branch,
  // so only the branch arm of the guard can catch it.
  it('fails when the open story sits on another branch of the same story', async () => {
    seedOpenStory()
    openOnBranch('b-other')

    const { result } = await runRetrievalPhase()

    expect(result).toEqual({
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'retrieval: no open story for branch' },
    })
    expect(runRetrievalMock).not.toHaveBeenCalled()
  })

  it('fails when the entries store is loaded for another branch', async () => {
    seedOpenStory({ entriesBranch: 'b-other' })

    const { result } = await runRetrievalPhase()

    expect(result).toEqual({
      status: 'failed',
      error: {
        kind: 'orchestrator',
        detail: 'retrieval: entries store loaded for another branch',
      },
    })
    expect(runRetrievalMock).not.toHaveBeenCalled()
  })
})

describe('retrieval phase — embedder config', () => {
  it('fails blocking when the embedder config does not resolve', async () => {
    seedOpenStory({ settings: { embeddingBackend: 'provider', embedding_provider_id: undefined } })

    const { result } = await runRetrievalPhase()

    expect(result).toEqual({
      status: 'failed',
      error: {
        kind: 'embedder',
        reason: 'init',
        detail: 'embedder not configured: no-provider',
        // Nothing counted anything — this failed before the dirty set was read.
        staleCount: null,
      },
    })
    expect(runRetrievalMock).not.toHaveBeenCalled()
  })

  it('fails blocking when the config resolves but its read dim is still unknown', async () => {
    seedOpenStory({
      settings: {
        embeddingBackend: 'provider',
        embedding_provider_id: 'prov-1',
        embedding_model_id: 'text-embedding-3-small',
      },
    })

    const { result } = await runRetrievalPhase()

    // toEqual, not toMatchObject: only `detail` separates this from the
    // config-resolution failure above, so dropping it would let a config
    // resolver that rejects the unknown provider id pass as this guard.
    expect(result).toEqual({
      status: 'failed',
      error: {
        kind: 'embedder',
        reason: 'init',
        detail: 'embedder dim unknown for model text-embedding-3-small',
        staleCount: null,
      },
    })
    expect(runRetrievalMock).not.toHaveBeenCalled()
  })

  it('runs the pass on a resolvable local config', async () => {
    seedOpenStory()

    const { result } = await runRetrievalPhase()

    expect(result).toEqual({ status: 'completed' })
    expect(runRetrievalMock).toHaveBeenCalledTimes(1)
  })
})

describe('retrieval phase — blocking failure mapping', () => {
  it('maps an init failure with a stale-row magnitude field by field', async () => {
    seedOpenStory()
    runRetrievalMock.mockResolvedValue({
      ok: false,
      failure: { reason: 'init', detail: 'no embedder integration', staleCount: 7 },
    })

    const { result } = await runRetrievalPhase()

    expect(result).toEqual({
      status: 'failed',
      error: {
        kind: 'embedder',
        reason: 'init',
        detail: 'no embedder integration',
        staleCount: 7,
      },
    })
  })

  // Second arm so no field can be hardcoded: reason, detail and staleCount all
  // differ from the case above.
  it('maps a call failure whose magnitude is unknown', async () => {
    seedOpenStory()
    runRetrievalMock.mockResolvedValue({
      ok: false,
      failure: { reason: 'call', detail: 'query embed served dim 512', staleCount: null },
    })

    const { result } = await runRetrievalPhase()

    expect(result).toEqual({
      status: 'failed',
      error: {
        kind: 'embedder',
        reason: 'call',
        detail: 'query embed served dim 512',
        staleCount: null,
      },
    })
  })

  it('stashes nothing on the intermediates when the pass fails', async () => {
    seedOpenStory()
    runRetrievalMock.mockResolvedValue({
      ok: false,
      failure: { reason: 'call', detail: 'boom', staleCount: null },
    })

    const { intermediates, events } = await runRetrievalPhase()

    expect(intermediates).toEqual({})
    // Failure returns, never emits: a `recoverable_error` event here would let
    // the orchestrator keep the turn running past a blocking embed failure.
    expect(events).toEqual([])
  })
})

describe('retrieval phase — success', () => {
  it('stashes the outcome for the narrative phase and yields no events', async () => {
    seedOpenStory()

    const { result, events, intermediates } = await runRetrievalPhase()

    expect(result).toEqual({ status: 'completed' })
    expect(intermediates[RETRIEVAL_INTERMEDIATE_KEY]).toBe(OK_OUTCOME)
    // The phase is event-free; an accidental emission here would write an
    // unregistered delta-action kind.
    expect(events).toEqual([])
  })

  it('hands the pass the full dep surface, not just the query embedder', async () => {
    seedOpenStory()

    await runRetrievalPhase()

    const deps = runRetrievalMock.mock.calls.at(-1)?.[0] as Record<string, unknown>
    // Key-set equality, not spot checks: the embed trio arrives as one spread,
    // so dropping it leaves queryAll/runInTransaction in place and every
    // params-shaped assertion in this file still green.
    expect(Object.keys(deps).sort()).toEqual([
      'branchIds',
      'embedRows',
      'embedTexts',
      'loadStaleRows',
      'queryAll',
      'runInTransaction',
    ])
    for (const key of ['embedRows', 'embedTexts', 'loadStaleRows', 'queryAll', 'runInTransaction'])
      expect(typeof deps[key]).toBe('function')
  })
})

describe('retrieval phase — abort', () => {
  it('aborts before the pass when the turn was cancelled during the lazy import', async () => {
    seedOpenStory()

    const { result } = await runRetrievalPhase(abortedSignal())

    expect(result).toEqual({ status: 'aborted' })
    expect(runRetrievalMock).not.toHaveBeenCalled()
  })

  it('aborts after a pass the cancel landed mid-way through, stashing nothing', async () => {
    seedOpenStory()
    const controller = new AbortController()
    runRetrievalMock.mockImplementation(async () => {
      controller.abort()
      return OK_OUTCOME
    })

    const { result, intermediates } = await runRetrievalPhase(controller.signal)

    // Distinct from the case above: the pass DID run, so only the poll after it
    // can catch this.
    expect(runRetrievalMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ status: 'aborted' })
    expect(intermediates).toEqual({})
  })

  it('reports a cancelled turn as aborted even when the pass also failed', async () => {
    seedOpenStory()
    const controller = new AbortController()
    runRetrievalMock.mockImplementation(async () => {
      controller.abort()
      return { ok: false, failure: { reason: 'call', detail: 'boom', staleCount: null } }
    })

    const { result, log } = await runRetrievalPhase(controller.signal)

    // Same precedence as narrativePhase: a cancel outranks whatever the work it
    // cancelled reported, so a stopped turn raises no failure banner.
    expect(result).toEqual({ status: 'aborted' })
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('completes the same pass when nothing cancels it', async () => {
    seedOpenStory()

    const { result, intermediates } = await runRetrievalPhase()

    expect(result).toEqual({ status: 'completed' })
    expect(intermediates[RETRIEVAL_INTERMEDIATE_KEY]).toBe(OK_OUTCOME)
  })
})

describe('retrieval phase — diagnostics', () => {
  it('warns with the failure magnitude when the pass fails', async () => {
    seedOpenStory()
    runRetrievalMock.mockResolvedValue({
      ok: false,
      failure: { reason: 'call', detail: 'embedder session died', staleCount: 4 },
    })

    const { log } = await runRetrievalPhase()

    expect(log.warn).toHaveBeenCalledWith('retrieval.embed_failed', {
      reason: 'call',
      staleCount: 4,
    })
  })

  it('trips on rows the blocking sync stage left stale', async () => {
    seedOpenStory()
    const counts = { entities: 0, lore: 3, happenings: 0, threads: 0, chapters: 0 }
    runRetrievalMock.mockResolvedValue(okOutcome(counts))

    const { result, log } = await runRetrievalPhase()

    expect(log.warn).toHaveBeenCalledWith('retrieval.stale_after_sync', counts)
    // A tripwire, not a gate: the turn still goes through.
    expect(result).toEqual({ status: 'completed' })
  })

  it('stays quiet when every count is zero', async () => {
    seedOpenStory()

    const { log } = await runRetrievalPhase()

    expect(log.warn).not.toHaveBeenCalled()
  })
})

describe('retrieval phase — RetrievalParams assembly', () => {
  it('carries the branch, the resolved model and its read dim', async () => {
    seedOpenStory({ entries: [entry(1, 'user_action', 'I draw the blade.', meta())] })

    await runRetrievalPhase()

    expect(lastParams()).toMatchObject({
      branchId: 'b1',
      modelId: 'Xenova/all-MiniLM-L6-v2',
      dim: 384,
    })
  })

  // Second model so neither field can be a constant that happens to match the
  // default story: both the id and the dim move together with the setting.
  it('follows the story to another catalog model and its dim family', async () => {
    seedOpenStory({ settings: { embedding_model_id: 'onnx-community/embeddinggemma-300m-ONNX' } })

    await runRetrievalPhase()

    expect(lastParams()).toMatchObject({
      modelId: 'onnx-community/embeddinggemma-300m-ONNX',
      dim: 768,
    })
  })

  it('scopes the sync stage to the branch being read', async () => {
    seedOpenStory()

    await runRetrievalPhase()

    expect(runRetrievalMock.mock.calls.at(-1)?.[0]).toMatchObject({ branchIds: ['b1'] })
  })

  it("takes the budgets from the story's settings, not the code defaults", async () => {
    seedOpenStory({
      settings: {
        retrievalBudgets: { entities: 11, lore: 22, happenings: 33, threads: 44, chapters: 55 },
      },
    })

    await runRetrievalPhase()

    expect(lastParams().budgets).toEqual({
      entities: 11,
      lore: 22,
      happenings: 33,
      threads: 44,
      chapters: 55,
    })
  })

  it('takes the scene and location off the tail entry, narrowing characters by kind', async () => {
    seedOpenStory({
      entities: [
        entity('char_hero', 'character', 'Kael'),
        entity('item_blade', 'item', 'Blade'),
        entity('loc_keep', 'location', 'The Keep'),
      ],
      entries: [
        entry(
          1,
          'user_action',
          'I draw the blade.',
          meta({
            sceneEntities: ['char_hero', 'item_blade'],
            currentLocationId: 'loc_keep',
          }),
        ),
      ],
    })

    await runRetrievalPhase()

    const params = lastParams()
    // Positive control on both sides of the kind filter: the item is in the
    // scene set and out of the character set, so a filter that passed
    // everything (or nothing) fails here.
    expect(params.sceneEntityIds).toEqual(['char_hero', 'item_blade'])
    expect(params.sceneCharacterIds).toEqual(['char_hero'])
    expect(params.currentLocationId).toBe('loc_keep')
  })

  it('falls back to an empty scene when the branch has no entries at all', async () => {
    seedOpenStory()

    await runRetrievalPhase()

    expect(lastParams()).toMatchObject({
      sceneEntityIds: [],
      sceneCharacterIds: [],
      currentLocationId: null,
    })
  })

  it("takes Q1 from the turn's own user action", async () => {
    seedOpenStory({
      entries: [
        entry(1, 'opening', 'The keep stands.', meta()),
        entry(2, 'user_action', 'I draw the blade.', meta()),
      ],
    })

    await runRetrievalPhase()

    expect(lastParams().query.userAction).toBe('I draw the blade.')
  })

  it('leaves Q1 empty rather than reaching back when the tail is not a user action', async () => {
    seedOpenStory({
      entries: [
        entry(1, 'user_action', 'I draw the blade.', meta()),
        entry(2, 'ai_reply', 'Steel sings.', meta()),
      ],
    })

    await runRetrievalPhase()

    expect(lastParams().query.userAction).toBe('')
  })

  it('takes Q3 from the last ai_reply', async () => {
    seedOpenStory({
      entries: [
        entry(1, 'opening', 'The keep stands.', meta()),
        entry(2, 'user_action', 'I look around.', meta()),
        entry(3, 'ai_reply', 'The hall is cold.', meta()),
        entry(4, 'user_action', 'I draw the blade.', meta()),
      ],
    })

    await runRetrievalPhase()

    expect(lastParams().query.lastNarrativeContent).toBe('The hall is cold.')
  })

  // Cold start (retrieval.md → Cold start): turn 1 has no ai_reply, and the
  // opening entry the wizard always commits is what Q3 extracts from. Selecting
  // ai_reply alone passes '' and silently drops Q3 on the first turn of every
  // story.
  it('takes Q3 from the opening entry on turn 1', async () => {
    seedOpenStory({
      entries: [
        entry(1, 'opening', 'The keep stands against the ash.', meta()),
        entry(2, 'user_action', 'I draw the blade.', meta()),
      ],
    })

    await runRetrievalPhase()

    expect(lastParams().query.lastNarrativeContent).toBe('The keep stands against the ash.')
  })

  it('leaves Q3 empty when the branch carries no narrative entry', async () => {
    seedOpenStory({ entries: [entry(1, 'user_action', 'I draw the blade.', meta())] })

    await runRetrievalPhase()

    expect(lastParams().query.lastNarrativeContent).toBe('')
  })

  it("enriches Q2 with the last narrative entry's piggyback summary", async () => {
    seedOpenStory({
      entries: [
        entry(1, 'ai_reply', 'Steel sings.', meta({ summary: 'Kael drew on the guard.' })),
        entry(2, 'user_action', 'I press the attack.', meta()),
      ],
    })

    await runRetrievalPhase()

    expect(lastParams().query.piggybackSummary).toBe('Kael drew on the guard.')
  })

  it('leaves the Q2 summary line absent when the block never parsed', async () => {
    seedOpenStory({
      entries: [
        entry(1, 'ai_reply', 'Steel sings.', meta()),
        entry(2, 'user_action', 'I press the attack.', meta()),
      ],
    })

    await runRetrievalPhase()

    expect(lastParams().query.piggybackSummary).toBeNull()
  })

  it('leaves the Q2 era line absent — nothing writes branch_era_flips yet', async () => {
    seedOpenStory()

    await runRetrievalPhase()

    expect(lastParams().query.eraName).toBeNull()
  })

  it('scans the composed prompt buffer for Layer-A suppression, not the whole branch', async () => {
    seedOpenStory({
      settings: { partialChapterBuffer: 2, protectedBuffer: 0 },
      entries: [
        entry(1, 'opening', 'ancient-prose', meta()),
        entry(2, 'ai_reply', 'older-prose', meta()),
        entry(3, 'ai_reply', 'recent-prose', meta()),
        entry(4, 'user_action', 'newest-prose', meta()),
      ],
    })

    await runRetrievalPhase()

    const { recentProse } = lastParams()
    expect(recentProse).toContain('recent-prose')
    expect(recentProse).toContain('newest-prose')
    // Positive control on the window: prose that slid out of the buffer must
    // not suppress a staged namesake forever.
    expect(recentProse).not.toContain('older-prose')
    expect(recentProse).not.toContain('ancient-prose')
  })
})
