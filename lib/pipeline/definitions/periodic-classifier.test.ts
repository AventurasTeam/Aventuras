import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PipelineAction } from '@/lib/actions'
import {
  applyDeltaAction as realApplyDeltaAction,
  settleUserWrites,
} from '@/lib/actions/delta/apply-delta-action'
import {
  __resetBranchWriteLocks,
  holdBranchWriteExclusive,
  releaseBranchWriteExclusive,
} from '@/lib/actions/delta/branch-write-lock'
import { describeDeltaReplayError, reverseReplayDeltas } from '@/lib/actions/delta/reverse-replay'
import { generateStructured } from '@/lib/ai'
import {
  classifierExtractionSchema,
  classifierExtractionWithPlacesSchema,
  shouldCadenceFire,
  type EmbedDescriptions,
} from '@/lib/classifier'
import {
  branches,
  deltas,
  entities,
  happenings,
  stories,
  storyEntries,
  type CharacterRelationship,
  type ClassifierStatus,
  type Entity,
  type StoryEntry,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  clearBuffers,
  configureDiagnosticsGate,
  getDiagnosticsSnapshot,
  makeLogger,
} from '@/lib/diagnostics'
import {
  characterRelationshipsStore,
  currentStoryStore,
  entitiesStore,
  entriesStore,
  generationStore,
  happeningsStore,
  hydrateAppSettings,
  resetAllStores,
  type RunState,
} from '@/lib/stores'

import { __resetClassifierEmbedder, configureClassifierEmbedder } from './description-embedder'
import { PER_TURN_KIND } from './per-turn'
import {
  ensurePeriodicClassifierPipelineRegistered,
  PERIODIC_CLASSIFIER_KIND,
  PERIODIC_CLASSIFIER_RESOLVES,
  periodicClassifierPhase,
} from './periodic-classifier'
import { __resetRegistry, getPipeline } from '../authoring/registry'
import { configureDeltaActionPort } from '../runtime/action-port'
import { runPipeline, type RunCtx } from '../runtime/orchestrator'
import type { PhaseContext, TxResult } from '../types'

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: vi.fn(),
}))

const CHAR_KAEL = 'char_11111111-1111-1111-1111-111111111111'
const CHAR_ARIA = 'char_22222222-2222-2222-2222-222222222222'

const CLASSIFIER_WIRED_CONFIG = {
  providers: [
    {
      id: 'prov-1',
      type: 'openai-compatible' as const,
      displayName: 'Local',
      apiKey: 'k',
      endpoint: 'http://x/v1',
      favoriteModelIds: [] as string[],
    },
  ],
  profiles: [
    {
      id: 'agent-1',
      kind: 'agent' as const,
      name: 'Agent',
      modelRef: { providerId: 'prov-1', modelId: 'm' },
    },
  ],
  assignments: { classifier: 'agent-1' },
  defaultProviderId: 'prov-1',
  diagnostics: { enabled: false, debug_level_enabled: false },
}

type Harness = {
  ctx: PhaseContext
  /** Every value `$.processedThrough` took on, in write order. */
  watermarks: number[]
  status: () => ClassifierStatus | null
  /** Raw out-of-band write, standing in for the reversal clamp's own writer. */
  clamp: (processedThrough: number) => void
}

async function ctxWith(opts: {
  processedThrough: number | null
  headPosition: number
  entryKind?: StoryEntry['kind']
  entities?: Entity[]
  relationships?: CharacterRelationship[]
  seedStatus?: Partial<ClassifierStatus>
  /** Saved metadata per entry position; the other entries get `{}`. */
  entryMetadata?: Record<number, StoryEntry['metadata']>
  onWatermark?: (n: number) => void
  mentionedPlaces?: boolean
}): Promise<Harness> {
  const { db, sqlite } = await createTestDb()
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })

  const status = (): ClassifierStatus | null => {
    const row = sqlite.prepare('SELECT classifier_status AS s FROM branches WHERE id = ?').get('b1')
    const raw = (row as { s: string | null } | undefined)?.s
    return raw == null ? null : (JSON.parse(raw) as ClassifierStatus)
  }
  const clamp = (processedThrough: number): void => {
    sqlite
      .prepare(
        `UPDATE branches SET classifier_status = json_set(classifier_status, '$.processedThrough', ?) WHERE id = 'b1'`,
      )
      .run(processedThrough)
  }
  clamp(0)
  sqlite.prepare(`UPDATE branches SET classifier_status = ? WHERE id = 'b1'`).run(
    JSON.stringify({
      state: 'idle',
      lastSuccessAt: null,
      lastError: null,
      retryCount: 0,
      processedThrough: opts.processedThrough,
      ...opts.seedStatus,
    }),
  )

  const entries: StoryEntry[] = Array.from({ length: opts.headPosition }, (_, i) => ({
    id: `e${i + 1}`,
    branchId: 'b1',
    position: i + 1,
    kind: opts.entryKind ?? 'ai_reply',
    content: `turn ${i + 1}`,
  })) as unknown as StoryEntry[]
  // The phase reads its window from SQLite, so the rows must exist there. The
  // store hydrate below only stands in for what the reader UI happens to hold.
  for (const e of entries)
    await db.insert(storyEntries).values({
      ...e,
      chapterId: null,
      metadata: opts.entryMetadata?.[e.position] ?? {},
      createdAt: 1,
    } as never)

  resetAllStores()
  currentStoryStore.set({
    storyId: 's1',
    branchId: 'b1',
    definition: {} as never,
    settings: { models: {}, classifierMentionedPlaces: opts.mentionedPlaces ?? false } as never,
  })
  entriesStore.hydrate('b1', entries)
  entitiesStore.hydrate('b1', opts.entities ?? [])
  characterRelationshipsStore.hydrate('b1', opts.relationships ?? [])
  happeningsStore.hydrate('b1', [])

  const watermarks: number[] = []
  // Observed through the persisted column rather than by matching on SQL text,
  // so the assertion is about the watermark actually moving.
  const observed = new Proxy(db, {
    get(target, prop) {
      if (prop === 'run') {
        return async (query: never) => {
          const before = status()?.processedThrough ?? null
          const result = await (target as { run: (q: never) => Promise<unknown> }).run(query)
          const after = status()?.processedThrough ?? null
          if (after != null && after !== before) {
            watermarks.push(after)
            opts.onWatermark?.(after)
          }
          return result
        }
      }
      const value = Reflect.get(target, prop) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    },
  })

  return {
    ctx: {
      actionId: 'a1',
      abortSignal: new AbortController().signal,
      intermediates: {},
      log: makeLogger('a1'),
      runInTransaction: async () => undefined,
      db: observed as PhaseContext['db'],
      storyId: 's1',
      branchId: 'b1',
    },
    watermarks,
    status,
    clamp,
  }
}

const extraction = (over: Partial<Record<string, unknown>> = {}) => ({
  happenings: [],
  relationships: [],
  statusFlips: [],
  newCharacters: [],
  aliases: [],
  newFactions: [],
  memberships: [],
  ...over,
})

// Drive the generator to completion, collecting emitted events.
async function drain(ctx: PhaseContext) {
  const gen = periodicClassifierPhase(ctx)
  const events: unknown[] = []
  for (;;) {
    const next = await gen.next()
    if (next.done) return { events, result: next.value }
    events.push(next.value)
  }
}

const createdEntry = (events: unknown[]) =>
  (
    events.find((e) => (e as { action: { kind: string } }).action.kind === 'createEntity') as
      | { action: { payload: { entry: Record<string, unknown> } } }
      | undefined
  )?.action.payload.entry

describe('periodicClassifierPhase', () => {
  beforeEach(() => {
    // resetAllMocks, not clearAllMocks: a leaked mockResolvedValue would let a
    // guard test reach the LLM and still look green.
    vi.resetAllMocks()
    __resetRegistry()
    __resetClassifierEmbedder()
    // The phase driven directly takes its hold through the global port and nothing ends it.
    __resetBranchWriteLocks()
  })

  it('completes without emitting when the window is empty', async () => {
    const h = await ctxWith({ processedThrough: 3, headPosition: 3 })
    const before = h.status()
    const { events, result } = await drain(h.ctx)
    expect(events).toEqual([])
    expect(result).toEqual({ status: 'completed' })
    expect(generateStructured).not.toHaveBeenCalled()
    // No LLM call means no pass happened: status must be untouched, not "idle again".
    expect(h.status()).toEqual(before)
  })

  // Guards the seam a store-fed window cannot see: entriesStore holds only the
  // last ENTRIES_WINDOW_SIZE entries, so reading the window from it would start
  // the pass at the reader's oldest loaded row and then advance the watermark
  // past everything below it — prose silently never classified.
  it('starts the window at the watermark even when the reader store is paged past it', async () => {
    const h = await ctxWith({ processedThrough: 10, headPosition: 200 })
    // Stand in for a reader scrolled to the tail: only the last 50 rows loaded.
    entriesStore.hydrate(
      'b1',
      Array.from({ length: 50 }, (_, i) => ({
        id: `e${151 + i}`,
        branchId: 'b1',
        position: 151 + i,
        kind: 'ai_reply',
        content: `turn ${151 + i}`,
      })) as unknown as StoryEntry[],
    )
    vi.mocked(generateStructured).mockResolvedValue({ status: 'ok', value: extraction() } as never)

    const { result } = await drain(h.ctx)

    expect(result).toEqual({ status: 'completed' })
    const prompt = vi.mocked(generateStructured).mock.calls[0][1].user
    expect(prompt).toContain('turn 11')
    expect(prompt).not.toContain('turn 151')
    // maxEntries defaults to 20, so one pass claims 11..30 and the backlog drains.
    expect(h.status()?.processedThrough).toBe(30)
  })

  // Fails if the phase stops passing the store's rows or stops filtering them by branch.
  it('shows the classifier only the stored relationship rows for its own branch', async () => {
    const kael = {
      id: CHAR_KAEL,
      branchId: 'b1',
      kind: 'character',
      name: 'Kael',
      status: 'active',
      description: 'A courier.',
      keywords: [],
    } as unknown as Entity
    const aria = {
      id: CHAR_ARIA,
      branchId: 'b1',
      kind: 'character',
      name: 'Aria',
      status: 'active',
      description: 'His sister.',
      keywords: [],
    } as unknown as Entity
    const h = await ctxWith({
      processedThrough: 0,
      headPosition: 2,
      entities: [kael, aria],
      relationships: [
        {
          id: 'rel_1',
          branchId: 'b1',
          aId: CHAR_KAEL,
          bId: CHAR_ARIA,
          kind: 'ally',
          inverseKind: null,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'rel_2',
          branchId: 'other',
          aId: CHAR_KAEL,
          bId: CHAR_ARIA,
          kind: 'rival',
          inverseKind: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ] as CharacterRelationship[],
    })
    vi.mocked(generateStructured).mockResolvedValue({ status: 'ok', value: extraction() } as never)

    await drain(h.ctx)

    const { system, user } = vi.mocked(generateStructured).mock.calls[0][1]
    expect(user).toContain('Kael sees')
    expect(user).toContain('as: ally')
    expect(user).not.toContain('rival')
    // classifier.md → What the classifier reads: role line and rules lead; branch lists stay out.
    expect(system).toMatch(
      /^You are extracting structured world state from recent story prose\. Report only what the prose supports; never invent\.\n\nRules:\n\n- Provenance\. /,
    )
    expect(system).not.toContain('Kael sees')
    expect(system).not.toContain('as: ally')
  })

  // Fails if the phase stops filtering a saved scene to the branch's live entities:
  // a deleted id would reach the prompt raw or take a placeholder that names nothing.
  it("shows each turn's saved scene, leaving out ids the branch no longer has", async () => {
    const kael = {
      id: CHAR_KAEL,
      branchId: 'b1',
      kind: 'character',
      name: 'Kael',
      status: 'active',
      description: 'A courier.',
      keywords: [],
    } as unknown as Entity
    const h = await ctxWith({
      processedThrough: 0,
      headPosition: 1,
      entities: [kael],
      entryMetadata: {
        1: {
          sceneEntities: [CHAR_KAEL, 'char_99999999-9999-9999-9999-999999999999'],
          currentLocationId: 'loc_99999999-9999-9999-9999-999999999999',
          worldTime: 0,
        },
      },
    })
    vi.mocked(generateStructured).mockResolvedValue({ status: 'ok', value: extraction() } as never)

    await drain(h.ctx)

    const prompt = vi.mocked(generateStructured).mock.calls[0][1].user
    expect(prompt).toContain('[t1] scene: [c1]\nturn 1')
    expect(prompt).not.toMatch(/(char|loc|item|fact)_[0-9a-f]{8}-/)
  })

  // architecture.md → System and user halves.
  it('sends no cache marker: the call takes no sixth argument', async () => {
    const h = await ctxWith({ processedThrough: 0, headPosition: 1 })
    vi.mocked(generateStructured).mockResolvedValue({ status: 'ok', value: extraction() } as never)

    await drain(h.ctx)

    expect(vi.mocked(generateStructured).mock.calls[0]![5]).toBeUndefined()
  })

  it('advances past a window of only system entries, so the cadence cannot live-lock', async () => {
    const h = await ctxWith({ processedThrough: 0, headPosition: 2, entryKind: 'system' })
    const { events, result } = await drain(h.ctx)
    expect(events).toEqual([])
    expect(result).toEqual({ status: 'completed' })
    expect(generateStructured).not.toHaveBeenCalled()
    // Technical rows hold positions the model must never see; leaving the
    // watermark behind them re-fires the cadence on every run_complete forever.
    expect(h.status()?.processedThrough).toBe(2)
    expect(shouldCadenceFire({ status: h.status()!, unprocessedEntries: 0, cadence: 1 })).toBe(
      false,
    )
    // Nothing ran, so the lifecycle keys must not read as a successful pass.
    expect(h.status()).toMatchObject({ state: 'idle', lastSuccessAt: null, retryCount: 0 })
  })

  it('emits one delta per planned write, each with its own entryId', async () => {
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: extraction({
        happenings: [
          { title: 'A', sourceTurn: 't1', involvements: [], awareness: [] },
          { title: 'B', sourceTurn: 't2', involvements: [], awareness: [] },
        ],
      }),
    })
    const h = await ctxWith({ processedThrough: 0, headPosition: 2 })
    const { events } = await drain(h.ctx)
    expect(events.map((e) => (e as { entryId: string }).entryId)).toEqual(['e1', 'e2'])
    expect(events.map((e) => (e as { action: { kind: string } }).action.kind)).toEqual([
      'createHappening',
      'createHappening',
    ])
  })

  it('persists state: running before the model call, for the M7.2 status panel', async () => {
    const h = await ctxWith({ processedThrough: 0, headPosition: 1 })
    let stateAtCallTime: string | undefined
    vi.mocked(generateStructured).mockImplementation(async () => {
      stateAtCallTime = h.status()?.state
      return { status: 'ok', value: extraction() }
    })
    await drain(h.ctx)
    expect(stateAtCallTime).toBe('running')
  })

  it('restores the pre-run status on an early abort, so running is never stuck', async () => {
    const h = await ctxWith({ processedThrough: 0, headPosition: 1 })
    vi.mocked(generateStructured).mockResolvedValue({ status: 'aborted' })
    const { result } = await drain(h.ctx)
    expect(result).toEqual({ status: 'aborted' })
    expect(h.status()).toMatchObject({ state: 'idle', retryCount: 0, processedThrough: 0 })
  })

  it('advances processedThrough after the deltas, never before', async () => {
    const order: string[] = []
    const h = await ctxWith({
      processedThrough: 0,
      headPosition: 2,
      onWatermark: () => order.push('watermark'),
    })
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: extraction({
        happenings: [{ title: 'A', sourceTurn: 't1', involvements: [], awareness: [] }],
      }),
    })
    const gen = periodicClassifierPhase(h.ctx)
    for (;;) {
      const next = await gen.next()
      if (next.done) break
      order.push('delta')
    }
    expect(order).toEqual(['delta', 'watermark'])
    expect(h.status()).toMatchObject({
      state: 'idle',
      processedThrough: 2,
      retryCount: 0,
      lastSuccessAt: expect.any(Number),
    })
  })

  it('clears the retry state and the stale error when a pass recovers', async () => {
    const h = await ctxWith({
      processedThrough: 0,
      headPosition: 2,
      seedStatus: { state: 'retrying', retryCount: 2, lastError: 'rate limited' },
    })
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: extraction({
        happenings: [{ title: 'A', sourceTurn: 't1', involvements: [], awareness: [] }],
      }),
    })
    await drain(h.ctx)
    // A classifier that recovers but keeps reporting the old failure is what the
    // status surface would show the user.
    expect(h.status()).toMatchObject({
      state: 'idle',
      retryCount: 0,
      lastError: null,
      lastSuccessAt: expect.any(Number),
      processedThrough: 2,
    })
  })

  it('is abort-free once it holds its write lock: an abort mid-burst still commits', async () => {
    const h = await ctxWith({ processedThrough: 0, headPosition: 2 })
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: extraction({
        happenings: [
          { title: 'A', sourceTurn: 't1', involvements: [], awareness: [] },
          { title: 'B', sourceTurn: 't2', involvements: [], awareness: [] },
        ],
      }),
    })
    const controller = new AbortController()
    h.ctx.abortSignal = controller.signal
    const gen = periodicClassifierPhase(h.ctx)
    const first = await gen.next()
    expect(first.done).toBe(false)
    controller.abort()
    const events = [first.value]
    for (let next = await gen.next(); ; next = await gen.next()) {
      if (next.done) {
        expect(next.value).toEqual({ status: 'completed' })
        break
      }
      events.push(next.value)
    }
    expect(events).toHaveLength(2)
    expect(h.status()?.processedThrough).toBe(2)
  })

  // classifier.md → Background-task framing: abort-free starts at the write lock, not the call.
  it('discards on a cancel after the model call, before the hold', async () => {
    const h = await ctxWith({ processedThrough: 0, headPosition: 2 })
    vi.mocked(generateStructured).mockImplementation(async () => {
      h.ctx.abortSignal = AbortSignal.abort()
      return {
        status: 'ok',
        value: extraction({
          happenings: [{ title: 'A', sourceTurn: 't1', involvements: [], awareness: [] }],
        }),
      }
    })
    const { events, result } = await drain(h.ctx)
    expect(events).toEqual([])
    expect(result).toEqual({ status: 'aborted' })
    expect(h.status()).toMatchObject({ state: 'idle', retryCount: 0, processedThrough: 0 })
  })

  it('returns aborted with no deltas when the abort lands before parsing', async () => {
    vi.mocked(generateStructured).mockResolvedValue({ status: 'aborted' })
    const h = await ctxWith({ processedThrough: 0, headPosition: 2 })
    const { events, result } = await drain(h.ctx)
    expect(events).toEqual([])
    expect(result).toEqual({ status: 'aborted' })
    // An abort is not a failure: no retry state is burned.
    expect(h.status()).toMatchObject({ state: 'idle', retryCount: 0, processedThrough: 0 })
  })

  // A provider that accepts the request and never answers used to leave
  // 'running' persisted forever: the cadence guard and runNow's in-flight guard
  // both read it, so the pass was dead until the next boot. The expiry must land
  // as a failure, not an abort, or the backoff never arms and every later tick
  // rediscovers the same dead provider.
  it('treats a call that outlives the timeout as a retryable failure', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(generateStructured).mockImplementation(
        (...args: unknown[]) =>
          new Promise((resolve) => {
            const signal = args[4] as AbortSignal
            if (signal.aborted) resolve({ status: 'aborted' } as never)
            signal.addEventListener('abort', () => resolve({ status: 'aborted' } as never))
          }) as never,
      )
      const h = await ctxWith({ processedThrough: 0, headPosition: 2 })
      const pass = drain(h.ctx)
      await vi.advanceTimersByTimeAsync(300_000)
      const { events, result } = await pass

      expect(events).toEqual([])
      expect(result).toMatchObject({ status: 'failed', error: { reason: 'timeout' } })
      expect(h.status()).toMatchObject({ state: 'retrying', retryCount: 1, processedThrough: 0 })
      expect(h.status()?.lastError).toMatch(/timeout/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('still treats a real cancel as an abort, burning no retry state', async () => {
    const controller = new AbortController()
    vi.mocked(generateStructured).mockImplementation(
      (...args: unknown[]) =>
        new Promise((resolve) => {
          const signal = args[4] as AbortSignal
          if (signal.aborted) resolve({ status: 'aborted' } as never)
          signal.addEventListener('abort', () => resolve({ status: 'aborted' } as never))
        }) as never,
    )
    const h = await ctxWith({ processedThrough: 0, headPosition: 2 })
    const pass = drain({ ...h.ctx, abortSignal: controller.signal })
    controller.abort()
    const { result } = await pass

    expect(result).toEqual({ status: 'aborted' })
    expect(h.status()).toMatchObject({ state: 'idle', retryCount: 0 })
  })

  // The timeout timer stayed armed after an outer abort, so a cancel landing near
  // the boundary could still see it fire and be recorded as a provider timeout —
  // burning a retry on what the user deliberately cancelled.
  it('does not reclassify a late-cancel as a timeout once the outer signal aborts', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      vi.mocked(generateStructured).mockImplementation(
        (...args: unknown[]) =>
          new Promise((resolve) => {
            const signal = args[4] as AbortSignal
            const settle = () => setTimeout(() => resolve({ status: 'aborted' } as never), 5_000)
            if (signal.aborted) settle()
            else signal.addEventListener('abort', settle)
          }) as never,
      )
      const h = await ctxWith({ processedThrough: 0, headPosition: 2 })
      const pass = drain({ ...h.ctx, abortSignal: controller.signal })

      // Cancel just short of the cap, then run well past it while the call winds down.
      await vi.advanceTimersByTimeAsync(299_000)
      controller.abort()
      await vi.advanceTimersByTimeAsync(60_000)
      const { result } = await pass

      expect(result).toEqual({ status: 'aborted' })
      expect(h.status()).toMatchObject({ state: 'idle', retryCount: 0 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails without advancing the watermark on a provider failure', async () => {
    const watermarks: number[] = []
    vi.mocked(generateStructured).mockResolvedValue({ status: 'failed', detail: 'rate limited' })
    const h = await ctxWith({
      processedThrough: 0,
      headPosition: 2,
      onWatermark: (n: number) => watermarks.push(n),
    })
    const { events, result } = await drain(h.ctx)
    expect(events).toEqual([])
    expect(result).toMatchObject({ status: 'failed' })
    expect(watermarks).toEqual([])
    expect(h.status()).toMatchObject({
      state: 'retrying',
      retryCount: 1,
      lastError: 'rate limited',
      processedThrough: 0,
    })
  })

  it.each([
    ['branch', { storyId: 's1', branchId: 'other' }],
    ['story', { storyId: 'other', branchId: 'b1' }],
  ])('fails when the open %s differs from the run, before any LLM call', async (_which, open) => {
    const h = await ctxWith({ processedThrough: 0, headPosition: 2 })
    currentStoryStore.set({
      ...open,
      definition: {} as never,
      settings: { models: {} } as never,
    })
    const { result } = await drain(h.ctx)
    expect(result).toMatchObject({ status: 'failed', error: { kind: 'orchestrator' } })
    expect(generateStructured).not.toHaveBeenCalled()
  })

  // The window comes from SQLite, so a reader paged onto another branch is no
  // longer able to starve the pass — only a closed story stops it.
  it('fails when no story is open for the branch', async () => {
    const h = await ctxWith({ processedThrough: 0, headPosition: 2 })
    currentStoryStore.clear()
    const { result } = await drain(h.ctx)
    expect(result).toMatchObject({ status: 'failed', error: { kind: 'orchestrator' } })
    expect(generateStructured).not.toHaveBeenCalled()
  })

  it('maps placeholders back to uuids and leaves unknown refs for the planner to report', async () => {
    const kael = {
      id: CHAR_KAEL,
      branchId: 'b1',
      kind: 'character',
      name: 'Kael',
      status: 'active',
      description: 'A courier.',
      keywords: [],
    } as unknown as Entity
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: extraction({
        happenings: [
          {
            title: 'A',
            sourceTurn: 't1',
            involvements: [{ ref: 'c1' }, { ref: 'c9' }],
            awareness: [],
          },
        ],
      }),
    })
    const h = await ctxWith({ processedThrough: 0, headPosition: 2, entities: [kael] })
    const { events } = await drain(h.ctx)
    const involvements = events.filter(
      (e) => (e as { action: { kind: string } }).action.kind === 'createHappeningInvolvement',
    )
    // c1 is the placeholder the prompt carried for Kael; c9 was never allocated.
    expect(involvements).toHaveLength(1)
    expect(
      (involvements[0] as { action: { payload: { entry: { entityId: string } } } }).action.payload
        .entry.entityId,
    ).toBe(CHAR_KAEL)
  })

  // The prompt reserves NEW_HANDLE_PREFIX for newCharacters handles, but a
  // non-compliant model can still pick 'c1'. The reserved set is what keeps that
  // from redirecting every ref onto the existing entity the placeholder names.
  it('binds refs to the new character when its handle collides with a live placeholder', async () => {
    const kael = {
      id: CHAR_KAEL,
      branchId: 'b1',
      kind: 'character',
      name: 'Kael',
      status: 'active',
      description: 'A courier.',
      keywords: [],
    } as unknown as Entity
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: extraction({
        newCharacters: [
          {
            handle: 'c1',
            name: 'Jorin',
            description: 'A ferryman.',
            keywords: [],
            sourceTurn: 't1',
          },
        ],
        happenings: [
          { title: 'A', sourceTurn: 't1', involvements: [{ ref: 'c1' }], awareness: [] },
        ],
      }),
    })
    const h = await ctxWith({ processedThrough: 0, headPosition: 2, entities: [kael] })
    const { events } = await drain(h.ctx)

    const created = events.find(
      (e) => (e as { action: { kind: string } }).action.kind === 'createEntity',
    ) as { action: { payload: { entry: { id: string; name: string } } } }
    expect(created.action.payload.entry.name).toBe('Jorin')

    const involvement = events.find(
      (e) => (e as { action: { kind: string } }).action.kind === 'createHappeningInvolvement',
    ) as { action: { payload: { entry: { entityId: string } } } }
    expect(involvement.action.payload.entry.entityId).toBe(created.action.payload.entry.id)
    expect(involvement.action.payload.entry.entityId).not.toBe(CHAR_KAEL)
  })

  it('reconciles a new character against a staged namesake and promotes instead of creating', async () => {
    const vector = Float32Array.from([1, 0, 0])
    const embedder = vi.fn(async () => ({ vectors: [vector, vector], dim: 3 }))
    configureClassifierEmbedder(embedder)
    const staged = {
      id: CHAR_KAEL,
      branchId: 'b1',
      kind: 'character',
      name: 'Kael',
      status: 'staged',
      description: 'A courier.',
      keywords: [],
    } as unknown as Entity
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: extraction({
        newCharacters: [
          { handle: 'nc1', name: 'kael', description: 'The courier from the ford.', keywords: [] },
        ],
        // Refers to the character by its temp handle, which must survive the
        // return trip untouched for the planner's handleMap to resolve it.
        happenings: [
          { title: 'A', sourceTurn: 't1', involvements: [{ ref: 'nc1' }], awareness: [] },
        ],
      }),
    })
    const h = await ctxWith({ processedThrough: 0, headPosition: 2, entities: [staged] })
    const { events } = await drain(h.ctx)

    expect(embedder).toHaveBeenCalledWith(['The courier from the ford.', 'A courier.'])
    const actions = events.map((e) => (e as { action: { kind: string; payload: unknown } }).action)
    // Promote, not create: the namesake exists and the descriptions match.
    expect(actions.map((a) => a.kind)).toEqual([
      'promoteStagedEntity',
      'createHappening',
      'createHappeningInvolvement',
    ])
    expect(actions[0].payload).toMatchObject({ id: CHAR_KAEL })
    expect(actions[2].payload).toMatchObject({ entry: { entityId: CHAR_KAEL } })
  })

  describe('entities that change during the model call', () => {
    const character = (id: string, name: string) =>
      ({
        id,
        branchId: 'b1',
        kind: 'character',
        name,
        status: 'active',
        description: `${name}, described.`,
        keywords: [],
      }) as unknown as Entity

    it('flags a new character against a namesake the user created mid-call', async () => {
      // Orthogonal vectors: a distinct namesake, which reconcile creates with a flag.
      configureClassifierEmbedder(
        vi.fn(async () => ({
          vectors: [Float32Array.from([1, 0, 0]), Float32Array.from([0, 1, 0])],
          dim: 3,
        })),
      )
      vi.mocked(generateStructured).mockImplementation(async () => {
        entitiesStore.hydrate('b1', [character('char_user', 'Mara')])
        return {
          status: 'ok',
          value: extraction({
            newCharacters: [{ handle: 'nc1', name: 'Mara', description: 'A smith.', keywords: [] }],
          }),
        }
      })
      const h = await ctxWith({ processedThrough: 0, headPosition: 2 })
      const { events } = await drain(h.ctx)

      expect(createdEntry(events)).toMatchObject({
        nameCollisionFlag: 1,
        nameCollisionPartnerId: 'char_user',
        nameCollisionReason: 'distinct',
      })
    })

    it('drops a fact about a character the user deleted mid-call', async () => {
      vi.mocked(generateStructured).mockImplementation(async () => {
        entitiesStore.hydrate('b1', [])
        return {
          status: 'ok',
          value: extraction({
            statusFlips: [{ ref: 'char_gone', to: 'retired', sourceTurn: 't1' }],
          }),
        }
      })
      const h = await ctxWith({
        processedThrough: 0,
        headPosition: 2,
        entities: [character('char_gone', 'Oswin')],
      })
      const { events, result } = await drain(h.ctx)

      const kinds = events.map((e) => (e as { action?: { kind: string } }).action?.kind)
      expect(kinds).not.toContain('retireEntity')
      expect(result).toEqual({ status: 'completed' })
    })
  })

  // A keyword hit makes a namesake too (classifier.md -> Namesakes), so the candidate's
  // keywords must reach reconciliation. No embedder is wired: the namesake is unscored.
  it("matches a namesake through the candidate's keywords", async () => {
    const innkeeper = {
      id: CHAR_KAEL,
      branchId: 'b1',
      kind: 'character',
      name: 'The Innkeeper',
      status: 'active',
      description: 'Keeps the Gull.',
      keywords: [],
      nameCollisionFlag: 0,
      createdAt: 1,
    } as unknown as Entity
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: extraction({
        newCharacters: [
          {
            handle: 'new:m',
            name: 'Marta',
            description: 'Runs the inn.',
            keywords: ['the innkeeper'],
            sourceTurn: 't1',
          },
        ],
      }),
    })
    const h = await ctxWith({ processedThrough: 0, headPosition: 2, entities: [innkeeper] })
    const { events } = await drain(h.ctx)

    expect(createdEntry(events)).toMatchObject({
      name: 'Marta',
      nameCollisionFlag: 1,
      nameCollisionPartnerId: CHAR_KAEL,
      nameCollisionReason: 'no-signal',
    })
  })

  // classifier.md -> Disambiguation -> Signals: scene presence reads the saved scene of
  // the candidate's own sourceTurn, never the head's after a fallback.
  describe('scene presence', () => {
    const kael = {
      id: CHAR_KAEL,
      branchId: 'b1',
      kind: 'character',
      name: 'Kael',
      status: 'active',
      description: 'A courier.',
      keywords: [],
      nameCollisionFlag: 0,
      createdAt: 1,
    } as unknown as Entity
    const kaelInScene = (position: number) => ({
      [position]: { sceneEntities: [CHAR_KAEL], currentLocationId: null, worldTime: 0 },
    })
    const ambiguous = () =>
      configureClassifierEmbedder(
        vi.fn(async () => ({
          vectors: [Float32Array.from([1, 0]), Float32Array.from([0.6, 0.8])],
          dim: 2,
        })),
      )

    it('flags a partial namesake in the scene as in-scene, with it as the partner', async () => {
      configureClassifierEmbedder(
        vi.fn(async () => ({
          vectors: [Float32Array.from([1, 0, 0]), Float32Array.from([0, 1, 0])],
          dim: 3,
        })),
      )
      vi.mocked(generateStructured).mockResolvedValue({
        status: 'ok',
        value: extraction({
          newCharacters: [
            {
              handle: 'new:k',
              name: 'Kael',
              description: 'A smith.',
              keywords: [],
              sourceTurn: 't1',
            },
          ],
        }),
      })
      const h = await ctxWith({
        processedThrough: 0,
        headPosition: 2,
        entities: [{ ...kael, name: 'Kael Stormborn' }],
        entryMetadata: kaelInScene(1),
      })
      const { events } = await drain(h.ctx)

      expect(createdEntry(events)).toMatchObject({
        name: 'Kael',
        nameCollisionFlag: 1,
        nameCollisionPartnerId: CHAR_KAEL,
        nameCollisionReason: 'in-scene',
      })
    })

    it("absorbs an ambiguous exact namesake in the scene of the candidate's turn", async () => {
      ambiguous()
      vi.mocked(generateStructured).mockResolvedValue({
        status: 'ok',
        value: extraction({
          newCharacters: [
            {
              handle: 'new:k',
              name: 'Kael',
              description: 'The courier, back from the ford.',
              keywords: [],
              sourceTurn: 't2',
            },
          ],
          happenings: [
            { title: 'A', sourceTurn: 't2', involvements: [{ ref: 'new:k' }], awareness: [] },
          ],
        }),
      })
      const h = await ctxWith({
        processedThrough: 0,
        headPosition: 2,
        entities: [kael],
        entryMetadata: kaelInScene(2),
      })
      const { events } = await drain(h.ctx)

      const actions = events.map(
        (e) => (e as { action: { kind: string; payload: unknown } }).action,
      )
      expect(actions.map((a) => a.kind)).toEqual(['createHappening', 'createHappeningInvolvement'])
      expect(actions[1].payload).toMatchObject({ entry: { entityId: CHAR_KAEL } })
    })

    it('ignores the head scene when the sourceTurn falls back to the window head', async () => {
      ambiguous()
      vi.mocked(generateStructured).mockResolvedValue({
        status: 'ok',
        value: extraction({
          newCharacters: [
            {
              handle: 'new:k',
              name: 'Kael',
              description: 'The courier, back from the ford.',
              keywords: [],
              sourceTurn: 't9',
            },
          ],
        }),
      })
      const h = await ctxWith({
        processedThrough: 0,
        headPosition: 2,
        entities: [kael],
        entryMetadata: kaelInScene(2),
      })
      const { events } = await drain(h.ctx)

      expect(createdEntry(events)).toMatchObject({
        nameCollisionFlag: 1,
        nameCollisionPartnerId: CHAR_KAEL,
        nameCollisionReason: 'ambiguous',
      })
    })
  })

  // A blank name matches no row, but a keyword naming one would still make a namesake.
  it('never reconciles a blank-named candidate, even one whose keywords name a row', async () => {
    const embedder = vi.fn(async () => ({ vectors: [], dim: 3 }))
    configureClassifierEmbedder(embedder)
    const staged = {
      id: CHAR_KAEL,
      branchId: 'b1',
      kind: 'character',
      name: 'Kael',
      status: 'staged',
      description: 'A courier.',
      keywords: [],
    } as unknown as Entity
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: extraction({
        newCharacters: [{ handle: 'nc1', name: ' ', description: 'Someone.', keywords: ['Kael'] }],
      }),
    })
    const h = await ctxWith({ processedThrough: 0, headPosition: 2, entities: [staged] })
    const { events } = await drain(h.ctx)

    expect(embedder).not.toHaveBeenCalled()
    const kinds = events.map((e) => (e as { action?: { kind: string } }).action?.kind)
    expect(kinds).not.toContain('promoteStagedEntity')
    expect(kinds).not.toContain('createEntity')
  })

  // The reconcile key must be bounded like the stored name, or an over-long name never
  // matches the row it created and the character is introduced again every pass.
  it('matches a stored name against the bounded form of an over-long candidate', async () => {
    const vector = Float32Array.from([1, 0, 0])
    configureClassifierEmbedder(vi.fn(async () => ({ vectors: [vector, vector], dim: 3 })))
    const stored = {
      id: CHAR_KAEL,
      branchId: 'b1',
      kind: 'character',
      name: 'K'.repeat(120),
      status: 'active',
      description: 'A courier.',
      keywords: [],
    } as unknown as Entity
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: extraction({
        newCharacters: [
          {
            handle: 'nc1',
            name: 'K'.repeat(120) + 'Y'.repeat(80),
            description: 'A courier.',
            keywords: [],
          },
        ],
        happenings: [
          { title: 'A', sourceTurn: 't1', involvements: [{ ref: 'nc1' }], awareness: [] },
        ],
      }),
    })
    const h = await ctxWith({ processedThrough: 0, headPosition: 2, entities: [stored] })
    const { events } = await drain(h.ctx)

    const actions = events.map((e) => (e as { action: { kind: string; payload: unknown } }).action)
    expect(actions.map((a) => a.kind)).not.toContain('createEntity')
    expect(actions.at(-1)?.payload).toMatchObject({ entry: { entityId: CHAR_KAEL } })
  })

  // The reconcile key must be bounded like the stored description: a re-describing
  // candidate embeds the text the row holds, not the tail the row dropped.
  it('embeds the stored form of an over-long description on both sides', async () => {
    const vector = Float32Array.from([1, 0, 0])
    const embed = vi.fn<EmbedDescriptions>(async () => ({ vectors: [vector, vector], dim: 3 }))
    configureClassifierEmbedder(embed)
    const stored = {
      id: CHAR_KAEL,
      branchId: 'b1',
      kind: 'character',
      name: 'Kael',
      status: 'active',
      // What a previous pass wrote: already cut to the embedded-column bound.
      description: 'D'.repeat(1200),
      keywords: [],
    } as unknown as Entity
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: extraction({
        newCharacters: [
          { handle: 'nc1', name: 'Kael', description: 'D'.repeat(2000), keywords: [] },
        ],
        happenings: [
          { title: 'A', sourceTurn: 't1', involvements: [{ ref: 'nc1' }], awareness: [] },
        ],
      }),
    })
    const h = await ctxWith({ processedThrough: 0, headPosition: 2, entities: [stored] })
    await drain(h.ctx)

    const texts = embed.mock.calls[0][0]
    expect(texts[0]).toHaveLength(1200)
    expect(texts[0]).toBe(texts[1])
  })

  it('never reverts a concurrent watermark clamp: status keys are written key-scoped', async () => {
    const h = await ctxWith({ processedThrough: 0, headPosition: 2 })
    vi.mocked(generateStructured).mockImplementation(async () => {
      // The reversal clamp is the other writer on this column and can land
      // between this run's status read and its status write.
      h.clamp(7)
      return {
        status: 'ok',
        value: extraction({
          happenings: [{ title: 'A', sourceTurn: 't1', involvements: [], awareness: [] }],
        }),
      }
    })
    await drain(h.ctx)
    // A whole-blob write would have serialized the read snapshot's 0 (or the
    // pass's own 2) over the clamp's 7.
    expect(h.status()).toMatchObject({ state: 'idle', processedThrough: 7 })
  })

  it('declares the classifier resolver input for pre-flight', () => {
    expect(PERIODIC_CLASSIFIER_RESOLVES).toEqual([{ target: 'classifier' }])
  })

  it('declares no-gate, self- and chapter-close-blocked, pill-only', () => {
    ensurePeriodicClassifierPipelineRegistered()
    const pipeline = getPipeline(PERIODIC_CLASSIFIER_KIND)
    expect(pipeline).toMatchObject({
      gateBehavior: 'no-gate',
      affordance: 'pill-only',
      concurrencyPolicy: { blockedBy: ['periodic-classifier', 'chapter-close'] },
    })
    // Idempotent: bootstrap and tests both call it.
    expect(() => ensurePeriodicClassifierPipelineRegistered()).not.toThrow()
  })

  // classifier.md → Factions.
  describe('factions', () => {
    const FACT_CIRCLE = 'fact_33333333-3333-3333-3333-333333333333'
    const row = (id: string, kind: Entity['kind'], name: string) =>
      ({
        id,
        branchId: 'b1',
        kind,
        name,
        status: 'active',
        description: 'Smiths who answer to no lord.',
        keywords: [],
        nameCollisionFlag: 0,
        createdAt: 1,
        state: kind === 'character' ? { faction_id: null } : {},
      }) as unknown as Entity
    const actionsOf = (events: unknown[]) =>
      events.map((e) => (e as { action: { kind: string; payload: unknown } }).action)
    const orthogonal = () =>
      configureClassifierEmbedder(
        vi.fn(async (texts: string[]) => ({
          vectors: texts.map((_, i) => Float32Array.from(i === 0 ? [1, 0] : [0, 1])),
          dim: 2,
        })),
      )

    it("never reads a faction's scene: a partial namesake in it below τ_low creates unflagged", async () => {
      orthogonal()
      vi.mocked(generateStructured).mockResolvedValue({
        status: 'ok',
        value: extraction({
          newFactions: [
            {
              handle: 'new:c',
              name: 'Circle',
              description: 'A gang.',
              keywords: [],
              sourceTurn: 't1',
            },
          ],
        }),
      })
      const h = await ctxWith({
        processedThrough: 0,
        headPosition: 2,
        entities: [row(FACT_CIRCLE, 'faction', 'The Iron Circle')],
        entryMetadata: {
          1: { sceneEntities: [FACT_CIRCLE], currentLocationId: null, worldTime: 0 },
        },
      })
      const { events } = await drain(h.ctx)

      expect(createdEntry(events)).toMatchObject({
        kind: 'faction',
        name: 'Circle',
        nameCollisionFlag: 0,
        nameCollisionReason: null,
      })
    })

    it("keeps a character's decision apart from a faction's on the same handle", async () => {
      vi.mocked(generateStructured).mockResolvedValue({
        status: 'ok',
        value: extraction({
          newCharacters: [
            {
              handle: 'new:x',
              name: 'Mara',
              description: 'A smith.',
              keywords: [],
              sourceTurn: 't1',
            },
          ],
          newFactions: [
            {
              handle: 'new:x',
              name: 'The Iron Circle',
              description: 'Smiths.',
              keywords: [],
              sourceTurn: 't1',
            },
          ],
        }),
      })
      const h = await ctxWith({
        processedThrough: 0,
        headPosition: 2,
        entities: [row(FACT_CIRCLE, 'faction', 'The Iron Circle')],
      })
      const { events } = await drain(h.ctx)

      expect(actionsOf(events).map((a) => a.kind)).toEqual(['createEntity'])
      expect(createdEntry(events)).toMatchObject({ kind: 'character', name: 'Mara' })
    })

    it('spends no embed call on a faction whose handle a character claimed', async () => {
      const embed = vi.fn(async () => ({
        vectors: [Float32Array.from([1, 0]), Float32Array.from([1, 0])],
        dim: 2,
      }))
      configureClassifierEmbedder(embed)
      vi.mocked(generateStructured).mockResolvedValue({
        status: 'ok',
        value: extraction({
          newCharacters: [
            {
              handle: 'new:x',
              name: 'Mara',
              description: 'A smith.',
              keywords: [],
              sourceTurn: 't1',
            },
          ],
          newFactions: [
            {
              handle: 'new:x',
              name: 'The Iron Circle',
              description: 'Smiths.',
              keywords: [],
              sourceTurn: 't1',
            },
          ],
        }),
      })
      const h = await ctxWith({
        processedThrough: 0,
        headPosition: 2,
        entities: [row(FACT_CIRCLE, 'faction', 'The Iron Circle')],
      })
      await drain(h.ctx)

      expect(embed).not.toHaveBeenCalled()
    })

    it('keeps the first declaration of a repeated newCharacters handle', async () => {
      vi.mocked(generateStructured).mockResolvedValue({
        status: 'ok',
        value: extraction({
          newCharacters: [
            {
              handle: 'new:k',
              name: 'Kael',
              description: 'A courier.',
              keywords: ['the courier'],
              sourceTurn: 't1',
            },
            {
              handle: 'new:k',
              name: 'Mara',
              description: 'A smith.',
              keywords: [],
              sourceTurn: 't1',
            },
          ],
        }),
      })
      configureClassifierEmbedder(
        vi.fn(async () => ({
          vectors: [Float32Array.from([1, 0]), Float32Array.from([1, 0])],
          dim: 2,
        })),
      )
      const h = await ctxWith({
        processedThrough: 0,
        headPosition: 2,
        entities: [{ ...row(CHAR_KAEL, 'character', 'Kael'), description: 'A courier.' } as Entity],
      })
      const { events } = await drain(h.ctx)

      const actions = actionsOf(events)
      expect(actions.map((a) => a.kind)).toEqual(['appendEntityKeywords'])
      expect(actions[0].payload).toMatchObject({ id: CHAR_KAEL, keywords: ['the courier'] })
    })

    it('binds a membership to the new faction when its handle collides with a live placeholder', async () => {
      vi.mocked(generateStructured).mockResolvedValue({
        status: 'ok',
        value: extraction({
          newFactions: [
            {
              handle: 'f1',
              name: 'The Grey Hand',
              description: 'Thieves.',
              keywords: [],
              sourceTurn: 't1',
            },
          ],
          memberships: [{ character: 'c1', faction: 'f1', sourceTurn: 't1' }],
        }),
      })
      const h = await ctxWith({
        processedThrough: 0,
        headPosition: 2,
        entities: [
          row(CHAR_KAEL, 'character', 'Kael'),
          row(FACT_CIRCLE, 'faction', 'The Iron Circle'),
        ],
      })
      const { events } = await drain(h.ctx)

      const created = createdEntry(events) as { id: string; name: string }
      expect(created.name).toBe('The Grey Hand')
      const membership = actionsOf(events).find((a) => a.kind === 'setCharacterFaction')
      expect(membership?.payload).toMatchObject({ id: CHAR_KAEL, factionId: created.id })
    })

    it("maps a membership's placeholders back to the character and faction ids", async () => {
      vi.mocked(generateStructured).mockResolvedValue({
        status: 'ok',
        value: extraction({
          memberships: [{ character: 'c1', faction: 'f1', sourceTurn: 't1' }],
        }),
      })
      const h = await ctxWith({
        processedThrough: 0,
        headPosition: 2,
        entities: [
          row(CHAR_KAEL, 'character', 'Kael'),
          row(FACT_CIRCLE, 'faction', 'The Iron Circle'),
        ],
      })
      const { events } = await drain(h.ctx)

      expect(actionsOf(events)).toEqual([
        {
          kind: 'setCharacterFaction',
          source: 'periodic_classifier',
          payload: { branchId: 'b1', id: CHAR_KAEL, factionId: FACT_CIRCLE, proseEntryId: 'e1' },
        },
      ])
    })
  })
})

// Not drain(): it skips the action layer, the only place apply-time rejection happens.
describe('periodicClassifierPhase apply-time failure (via runPipeline)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    __resetRegistry()
    __resetClassifierEmbedder()
    __resetBranchWriteLocks()
  })

  afterEach(() => {
    configureDeltaActionPort({
      applyDeltaAction: realApplyDeltaAction,
      reverseReplayDeltas,
      describeReplayError: describeDeltaReplayError,
      settleUserWrites,
      holdWritePhase: holdBranchWriteExclusive,
      releaseWritePhase: releaseBranchWriteExclusive,
    })
  })

  type TestDb = Awaited<ReturnType<typeof createTestDb>>
  type Seeded = Pick<TestDb, 'db' | 'runInTransaction'>

  async function seedStory(): Promise<Seeded> {
    const { db, runInTransaction } = await createTestDb()
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    resetAllStores()
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition: {} as never,
      settings: { models: {} } as never,
    })
    entitiesStore.hydrate('b1', [])
    happeningsStore.hydrate('b1', [])
    await hydrateAppSettings(async () => CLASSIFIER_WIRED_CONFIG)
    return { db, runInTransaction }
  }

  async function seedApplyTimeHarness(): Promise<Seeded> {
    const seeded = await seedStory()
    await seeded.db.insert(storyEntries).values({
      id: 'e1',
      branchId: 'b1',
      position: 1,
      kind: 'ai_reply',
      content: 'turn 1',
      chapterId: null,
      metadata: {},
      createdAt: 1,
    } as never)
    return seeded
  }

  function rejectCreateHappening(onReject?: () => void): void {
    configureDeltaActionPort({
      applyDeltaAction: (args, applyCtx) => {
        if (args.action.kind !== 'createHappening') return realApplyDeltaAction(args, applyCtx)
        onReject?.()
        return Promise.resolve({ status: 'rejected', reason: 'forced test rejection' })
      },
      reverseReplayDeltas,
      describeReplayError: describeDeltaReplayError,
      settleUserWrites,
      holdWritePhase: holdBranchWriteExclusive,
      releaseWritePhase: releaseBranchWriteExclusive,
    })
  }

  function registerWithReply(over: Partial<Record<string, unknown>> = {}): void {
    ensurePeriodicClassifierPipelineRegistered()
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: extraction({
        happenings: [{ title: 'A', sourceTurn: 't1', involvements: [], awareness: [] }],
        ...over,
      }),
    })
  }

  async function runOutcome(ctx: RunCtx): Promise<TxResult['outcome']> {
    const result = await runPipeline(PERIODIC_CLASSIFIER_KIND, ctx)
    if (result.outcome === 'rejected') throw new Error('unexpected rejected start')
    return result.outcome
  }

  async function storedStatus(db: TestDb['db']): Promise<ClassifierStatus | null> {
    const [row] = await db
      .select({ status: branches.classifierStatus })
      .from(branches)
      .where(eq(branches.id, 'b1'))
    return row.status
  }

  it('routes a write the action layer rejects to the retry status instead of leaving running stuck', async () => {
    const { db, runInTransaction } = await seedApplyTimeHarness()

    // Stands in for any action-layer rejection; the guard must recover from each the same way.
    rejectCreateHappening()
    registerWithReply()

    expect(await runOutcome({ storyId: 's1', branchId: 'b1', db, runInTransaction })).toBe('failed')

    const status = await storedStatus(db)
    expect(status).toMatchObject({ state: 'retrying', retryCount: 1 })
    expect(status?.lastError).toBe('classifier: forced test rejection')
  })

  it('still reaches the retry status when the first failure write fails', async () => {
    const { db, runInTransaction } = await seedApplyTimeHarness()
    let failNextStatusWrite = false
    rejectCreateHappening(() => {
      failNextStatusWrite = true
    })
    const flaky = new Proxy(db, {
      get(target, prop) {
        if (prop === 'run')
          return (...args: Parameters<typeof db.run>) => {
            if (failNextStatusWrite) {
              failNextStatusWrite = false
              throw new Error('SQLITE_BUSY')
            }
            return target.run(...args)
          }
        const value = Reflect.get(target, prop, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })

    registerWithReply()

    expect(await runOutcome({ storyId: 's1', branchId: 'b1', db: flaky, runInTransaction })).toBe(
      'failed',
    )

    expect(await storedStatus(db)).toMatchObject({ state: 'retrying', retryCount: 1 })
  })

  it('counts a pass whose watermark write fails as a failure, not a success', async () => {
    const { db, runInTransaction } = await seedApplyTimeHarness()
    await db.run(
      sql`UPDATE branches SET classifier_status = ${JSON.stringify({
        state: 'retrying',
        lastSuccessAt: null,
        lastError: 'rate limited',
        retryCount: 1,
        processedThrough: 0,
      })} WHERE id = 'b1'`,
    )
    let failWatermark = true
    type Chunk = { value?: unknown; queryChunks?: Chunk[] } | null
    const sqlText = (query: Chunk): string =>
      (query?.queryChunks ?? [])
        .map((chunk) => (Array.isArray(chunk?.value) ? chunk.value.join('') : sqlText(chunk)))
        .join('')
    const flaky = new Proxy(db, {
      get(target, prop) {
        if (prop === 'run')
          return (...args: Parameters<typeof db.run>) => {
            if (failWatermark && sqlText(args[0] as Chunk).includes('processedThrough')) {
              failWatermark = false
              throw new Error('SQLITE_FULL')
            }
            return target.run(...args)
          }
        const value = Reflect.get(target, prop, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })

    registerWithReply()

    const outcome = await runOutcome({ storyId: 's1', branchId: 'b1', db: flaky, runInTransaction })
    expect(failWatermark).toBe(false)
    expect(outcome).toBe('failed')

    expect(await storedStatus(db)).toMatchObject({
      state: 'retrying',
      retryCount: 2,
      lastSuccessAt: null,
      processedThrough: 0,
    })
  })

  // A failed reversal leaves the write on disk, so arming a retry would race a pass into
  // re-reading it. `running` stays for boot's resetStuckClassifierRunState, not the backoff.
  it('leaves running when the reversal itself cannot commit, deferring to boot recovery', async () => {
    const { db, runInTransaction } = await seedApplyTimeHarness()
    const fixedActionId = 'act_classifier_poison'
    await db.insert(deltas).values({
      id: 'd_classifier_poison',
      branchId: 'b1',
      entryId: null,
      actionId: fixedActionId,
      logPosition: 900,
      source: 'ai_classifier',
      targetTable: 'not_a_registered_table',
      targetId: 'x',
      op: 'create',
      undoPayload: null,
      encodingVersion: 1,
      createdAt: 1,
    })

    rejectCreateHappening()
    registerWithReply()

    expect(
      await runOutcome({
        storyId: 's1',
        branchId: 'b1',
        db,
        runInTransaction,
        actionId: fixedActionId,
      }),
    ).toBe('failed')

    expect(await storedStatus(db)).toMatchObject({ state: 'running', retryCount: 0 })
  })

  // cadence.md → User edits and classifier writes.
  it('completes a pass whose retire a newer user revive blocks, landing its other writes', async () => {
    const { db, runInTransaction } = await seedStory()

    // Through the action layer, so the entry's create delta dates the prose in the real log.
    const apply = async (action: PipelineAction, actionId: string) => {
      const result = await realApplyDeltaAction(
        { action, actionId, branchId: 'b1' },
        { db, runInTransaction },
      )
      expect(result.status).toBe('ok')
    }
    await apply(
      {
        kind: 'createEntity',
        source: 'user_edit',
        payload: {
          entry: {
            id: CHAR_KAEL,
            branchId: 'b1',
            kind: 'character',
            name: 'Kael',
            description: 'A courier.',
            status: 'retired',
            retiredReason: 'lost at sea',
            injectionMode: 'auto',
            createdAt: 1,
            updatedAt: 1,
          },
        },
      },
      'act_kael',
    )
    await apply(
      {
        kind: 'createStoryEntry',
        source: 'ai_classifier',
        payload: {
          entry: {
            id: 'e1',
            branchId: 'b1',
            position: 1,
            kind: 'ai_reply',
            content: 'turn 1',
            createdAt: 1,
          },
        },
      },
      'act_e1',
    )
    await apply(
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: {
          branchId: 'b1',
          id: CHAR_KAEL,
          patch: { status: 'active', retiredReason: null },
        },
      },
      'act_revive',
    )

    registerWithReply({
      statusFlips: [{ ref: 'c1', to: 'retired', reason: 'drowned', sourceTurn: 't1' }],
    })

    expect(await runOutcome({ storyId: 's1', branchId: 'b1', db, runInTransaction })).toBe(
      'completed',
    )

    const [kael] = await db.select().from(entities).where(eq(entities.id, CHAR_KAEL))
    expect(kael).toMatchObject({ status: 'active', retiredReason: null })
    const landed = await db.select().from(happenings).where(eq(happenings.branchId, 'b1'))
    expect(landed.map((h) => h.title)).toEqual(['A'])
    const classifierWrites = await db
      .select({ targetTable: deltas.targetTable })
      .from(deltas)
      .where(eq(deltas.source, 'periodic_classifier'))
    expect(classifierWrites.map((d) => d.targetTable)).toEqual(['happenings'])

    expect(await storedStatus(db)).toMatchObject({
      state: 'idle',
      processedThrough: 1,
      retryCount: 0,
      lastError: null,
    })
  })
})

describe('periodicClassifierPhase — the write phase', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    __resetRegistry()
    __resetClassifierEmbedder()
    __resetBranchWriteLocks()
  })

  const turnRun = (): RunState => ({
    runId: 'run_turn',
    kind: PER_TURN_KIND,
    gateBehavior: 'hard-gate',
    actionId: 'act_turn',
    storyId: 's1',
    branchId: 'b1',
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  })

  const place = (id: string, name: string, parent: string | null = null) =>
    ({
      id,
      branchId: 'b1',
      kind: 'location',
      name,
      status: 'active',
      description: `${name}, described.`,
      keywords: [],
      state: { parent_location_id: parent },
      createdAt: 1,
    }) as unknown as Entity

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

  // Drives the phase in the background, so a test can act while it waits.
  function start(ctx: PhaseContext) {
    let settled: Awaited<ReturnType<typeof drain>> | undefined
    const done = drain(ctx).then((value) => (settled = value))
    return { done, settled: () => settled }
  }

  const varnReply = () =>
    extraction({
      newPlaces: [
        {
          handle: 'new:varn',
          name: 'Varn',
          description: 'A salt town.',
          keywords: [],
          sourceTurn: 't1',
        },
      ],
      happenings: [
        {
          title: 'The fleet sails',
          sourceTurn: 't1',
          involvements: [{ ref: 'new:varn', role: 'site' }],
          awareness: [],
        },
      ],
    })

  // generation-pipeline.md → No-gate write phase; the race the setting's places would lose.
  it('waits out a turn on its branch, then reuses the place the turn created meanwhile', async () => {
    vi.mocked(generateStructured).mockResolvedValue({ status: 'ok', value: varnReply() })
    const h = await ctxWith({ processedThrough: 0, headPosition: 2, mentionedPlaces: true })
    generationStore.startRun(turnRun())
    const pass = start(h.ctx)
    await flush()
    expect(pass.settled()).toBeUndefined()

    // The turn creates the place the pass's reply names, then leaves txState.
    entitiesStore.hydrate('b1', [place('loc_varn', 'Varn')])
    generationStore.finishRun('run_turn')
    const { events, result } = await pass.done

    expect(result).toEqual({ status: 'completed' })
    const actions = events.map((e) => (e as { action: PipelineAction }).action)
    expect(actions.map((a) => a.kind)).toEqual(['createHappening', 'createHappeningInvolvement'])
    expect(actions[1].payload).toMatchObject({ entry: { entityId: 'loc_varn' } })
  })

  it('discards on a cancel while it waits for a turn', async () => {
    vi.mocked(generateStructured).mockResolvedValue({ status: 'ok', value: varnReply() })
    const h = await ctxWith({ processedThrough: 0, headPosition: 2, mentionedPlaces: true })
    const controller = new AbortController()
    h.ctx.abortSignal = controller.signal
    generationStore.startRun(turnRun())
    const pass = start(h.ctx)
    await flush()
    controller.abort()
    const { events, result } = await pass.done
    expect(events).toEqual([])
    expect(result).toEqual({ status: 'aborted' })
    expect(h.status()).toMatchObject({ state: 'idle', retryCount: 0, processedThrough: 0 })
  })

  it('discards on a cancel during the character reconciliation, cutting it short', async () => {
    const controller = new AbortController()
    const embedder = vi.fn(async () => {
      controller.abort()
      const v = Float32Array.from([1, 0, 0])
      return { vectors: [v, v], dim: 3 }
    })
    configureClassifierEmbedder(embedder)
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: extraction({
        newCharacters: [
          { handle: 'nc1', name: 'Kael', description: 'A courier.', keywords: [] },
          { handle: 'nc2', name: 'kael', description: 'The courier.', keywords: [] },
        ],
      }),
    })
    const h = await ctxWith({
      processedThrough: 0,
      headPosition: 2,
      entities: [
        { ...place(CHAR_KAEL, 'Kael'), kind: 'character', state: null } as unknown as Entity,
      ],
    })
    h.ctx.abortSignal = controller.signal
    const { events, result } = await drain(h.ctx)
    expect(events).toEqual([])
    expect(result).toEqual({ status: 'aborted' })
    expect(h.status()).toMatchObject({ state: 'idle', processedThrough: 0 })
    expect(embedder).toHaveBeenCalledTimes(1)
  })

  // Back on the branch by planning, but the reconciliation ran against another branch's roster.
  it('discards when the stores were away at the reconciliation read, even once back', async () => {
    const kael = {
      id: CHAR_KAEL,
      branchId: 'b1',
      kind: 'character',
      name: 'Kael',
      status: 'active',
      description: 'A courier.',
      keywords: [],
    } as unknown as Entity
    vi.mocked(generateStructured).mockImplementation(async () => {
      entitiesStore.hydrate('b2', [])
      return {
        status: 'ok',
        value: extraction({
          newCharacters: [{ handle: 'nc1', name: 'Kael', description: 'A courier.', keywords: [] }],
        }),
      }
    })
    const h = await ctxWith({ processedThrough: 0, headPosition: 2, entities: [kael] })
    generationStore.startRun(turnRun())
    const pass = start(h.ctx)
    await flush()
    entitiesStore.hydrate('b1', [kael])
    generationStore.finishRun('run_turn')
    const { events, result } = await pass.done
    expect(events).toEqual([])
    expect(result).toEqual({ status: 'aborted' })
  })

  it.each([
    ['during the model call', 'call'],
    ['while it waits for a turn', 'wait'],
  ] as const)('discards when the stores moved to another branch %s', async (_label, when) => {
    clearBuffers()
    configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
    vi.mocked(generateStructured).mockImplementation(async () => {
      if (when === 'call') entitiesStore.hydrate('b2', [])
      return { status: 'ok', value: varnReply() }
    })
    const h = await ctxWith({ processedThrough: 0, headPosition: 2, mentionedPlaces: true })
    if (when === 'wait') generationStore.startRun(turnRun())
    const pass = start(h.ctx)
    await flush()
    if (when === 'wait') {
      entitiesStore.hydrate('b2', [])
      generationStore.finishRun('run_turn')
    }
    const { events, result } = await pass.done
    expect(events).toEqual([])
    expect(result).toEqual({ status: 'aborted' })
    expect(h.status()).toMatchObject({ state: 'idle', retryCount: 0, processedThrough: 0 })
    const log = getDiagnosticsSnapshot().logEntries.find(
      (e) => e.kind === 'classifier.pass_discarded',
    )
    expect(log?.fields).toEqual({ reason: 'branch-unloaded' })
  })
})

// classifier.md → Mentioned places: the setting is read once, when the pass builds its prompt.
describe('periodicClassifierPhase — mentioned places', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    __resetRegistry()
    __resetClassifierEmbedder()
    __resetBranchWriteLocks()
  })

  const ford = {
    id: 'loc_11111111-1111-1111-1111-111111111111',
    branchId: 'b1',
    kind: 'location',
    name: 'The Ford',
    status: 'retired',
    retiredReason: 'washed away',
    description: 'Shallow and cold.',
    keywords: [],
    state: { parent_location_id: null },
    createdAt: 1,
  } as unknown as Entity

  it('with the setting on, asks for places by schema and rule, and creates them', async () => {
    let sent: { schema: unknown; system: string; user: string } | undefined
    vi.mocked(generateStructured).mockImplementation(async (_target, prompt, schema) => {
      sent = { schema, system: prompt.system, user: prompt.user }
      // Turned off mid-call: the reply still follows the prompt it answered.
      const open = currentStoryStore.getCurrentStory()
      if (open != null)
        currentStoryStore.set({
          ...open,
          settings: { ...open.settings, classifierMentionedPlaces: false },
        })
      return {
        status: 'ok',
        value: extraction({
          newPlaces: [
            {
              handle: 'new:inn',
              name: 'the Drowned Inn',
              description: 'An inn by the ford.',
              keywords: ['the inn'],
              sourceTurn: 't2',
              parent: 'l1',
            },
          ],
        }),
      }
    })
    const h = await ctxWith({
      processedThrough: 0,
      headPosition: 2,
      entities: [ford],
      mentionedPlaces: true,
    })
    const { events } = await drain(h.ctx)

    expect(sent?.schema).toBe(classifierExtractionWithPlacesSchema)
    expect(sent?.system).toContain('- New places. Add a place the turns mention')
    expect(sent?.user).toContain('- [l1] The Ford (retired: washed away) — Shallow and cold.')
    expect(createdEntry(events)).toMatchObject({
      kind: 'location',
      name: 'the Drowned Inn',
      keywords: ['the inn'],
      // Retired parent: the place goes to the root.
      state: { parent_location_id: null },
    })
    expect((events[0] as { entryId: string }).entryId).toBe('e2')
  })

  it('with the setting off, sends the base schema and no rule, but still the Places tree', async () => {
    let sent: { schema: unknown; system: string; user: string } | undefined
    vi.mocked(generateStructured).mockImplementation(async (_target, prompt, schema) => {
      sent = { schema, system: prompt.system, user: prompt.user }
      return { status: 'ok', value: extraction() }
    })
    const h = await ctxWith({ processedThrough: 0, headPosition: 2, entities: [ford] })
    await drain(h.ctx)
    expect(sent?.schema).toBe(classifierExtractionSchema)
    expect(sent?.system).not.toContain('New places')
    expect(sent?.user).toContain('- [l1] The Ford (retired: washed away)')
  })

  // As for a new character: a model that names a new place 'l1' keeps refs to it on the new row.
  it('binds refs to the new place when its handle collides with a live placeholder', async () => {
    const harbor = { ...ford, name: 'The Harbor', status: 'active', retiredReason: null } as Entity
    const place = (handle: string, name: string, over: Record<string, unknown> = {}) => ({
      handle,
      name,
      description: '',
      keywords: [],
      sourceTurn: 't1',
      ...over,
    })
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: extraction({
        newPlaces: [
          place('l1', 'the Drowned Inn'),
          place('new:cellar', 'the Cellar', { parent: 'l1' }),
        ],
        happenings: [
          { title: 'A', sourceTurn: 't1', involvements: [{ ref: 'l1' }], awareness: [] },
        ],
      }),
    })
    const h = await ctxWith({
      processedThrough: 0,
      headPosition: 2,
      entities: [harbor],
      mentionedPlaces: true,
    })
    const { events } = await drain(h.ctx)

    const entries = (kind: string) =>
      events
        .map((e) => e as { action: { kind: string; payload: { entry: Record<string, unknown> } } })
        .filter(({ action }) => action.kind === kind)
        .map(({ action }) => action.payload.entry)
    const created = entries('createEntity')
    const inn = created.find((e) => e.name === 'the Drowned Inn')
    expect(inn?.id).toMatch(/^loc_/)
    expect(inn?.id).not.toBe(harbor.id)
    expect(created.find((e) => e.name === 'the Cellar')?.state).toEqual({
      parent_location_id: inn?.id,
    })
    expect(entries('createHappeningInvolvement')).toEqual([
      expect.objectContaining({ entityId: inn?.id }),
    ])
  })

  it("logs a place dropped for a taken handle under the per-turn writer's key", async () => {
    clearBuffers()
    configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
    const place = (name: string) => ({ handle: 'new:inn', name, description: '', keywords: [] })
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: extraction({ newPlaces: [place('the Gull Inn'), place('the Drowned Inn')] }),
    })
    const h = await ctxWith({ processedThrough: 0, headPosition: 2, mentionedPlaces: true })
    const { events } = await drain(h.ctx)
    expect(createdEntry(events)).toMatchObject({ name: 'the Gull Inn' })
    const logs = getDiagnosticsSnapshot().logEntries.filter(
      (e) => e.kind === 'classifier.create_dropped',
    )
    expect(logs.map((e) => [e.level, e.fields])).toEqual([
      [
        'warn',
        { kind: 'location', handle: 'new:inn', name: 'the Drowned Inn', cause: 'handle-taken' },
      ],
    ])
  })

  it("logs a place sent to the root under the per-turn writer's key and cause", async () => {
    clearBuffers()
    configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: extraction({
        newPlaces: [
          {
            handle: 'new:inn',
            name: 'Inn',
            description: '',
            keywords: [],
            sourceTurn: 't1',
            parent: 'l1',
          },
        ],
      }),
    })
    const h = await ctxWith({
      processedThrough: 0,
      headPosition: 2,
      entities: [ford],
      mentionedPlaces: true,
    })
    await drain(h.ctx)
    const log = getDiagnosticsSnapshot().logEntries.find(
      (e) => e.kind === 'classifier.create_parent_dropped',
    )
    expect(log?.level).toBe('warn')
    expect(log?.fields).toEqual({ handle: 'new:inn', parent: ford.id, cause: 'retired' })
  })
})
