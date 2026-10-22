import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  bracketProseReversal,
  classifierWatermarkClampOps,
  type PipelineAction,
} from '@/lib/actions'
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
import { generateStructured, type ResolveModelConfig } from '@/lib/ai'
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
  __resetDiagnosticsGate,
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
  interruptMemoryRuns,
  resetAllStores,
} from '@/lib/stores'

import { __resetClassifierEmbedder, configureClassifierEmbedder } from './description-embedder'
import { unprocessedEntryCount } from './memory-chain'
import { PER_TURN_KIND } from './per-turn'
import {
  ensurePeriodicClassifierPipelineRegistered,
  passTimeoutMs,
  PERIODIC_CLASSIFIER_KIND,
  PERIODIC_CLASSIFIER_RESOLVES,
  periodicClassifierPhase,
} from './periodic-classifier'
import { __resetRegistry, getPipeline } from '../authoring/registry'
import { configureDeltaActionPort, type DeltaActionPort } from '../runtime/action-port'
import { runPipeline, type RunCtx } from '../runtime/orchestrator'
import type { PhaseContext, Pipeline, TxResult } from '../types'

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

function interruptHook(): NonNullable<Pipeline['onInterrupt']> {
  ensurePeriodicClassifierPipelineRegistered()
  const { onInterrupt } = getPipeline(PERIODIC_CLASSIFIER_KIND)
  if (!onInterrupt) throw new Error('the pass declares no onInterrupt')
  return onInterrupt
}

const createdEntry = (events: unknown[]) =>
  (
    events.find((e) => (e as { action: { kind: string } }).action.kind === 'createEntity') as
      | { action: { payload: { entry: Record<string, unknown> } } }
      | undefined
  )?.action.payload.entry

// The log tests switch the gate on; without this, later tests would run under it.
afterEach(() => __resetDiagnosticsGate())

describe('periodicClassifierPhase', () => {
  beforeEach(() => {
    // resetAllMocks, not clearAllMocks: a leaked mockResolvedValue would let a
    // guard test reach the LLM and still look green.
    vi.resetAllMocks()
    __resetRegistry()
    __resetClassifierEmbedder()
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

  // classifier.md → Persistence: a system row is no prose to process, and a trailing one's
  // position is the next user_action's.
  it('completes a window of only system entries with no call, leaving the watermark', async () => {
    const h = await ctxWith({ processedThrough: 0, headPosition: 2, entryKind: 'system' })
    const before = h.status()
    const { events, result } = await drain(h.ctx)
    expect(events).toEqual([])
    expect(result).toEqual({ status: 'completed' })
    expect(generateStructured).not.toHaveBeenCalled()
    expect(h.watermarks).toEqual([])
    expect(h.status()).toEqual(before)
    // The cadence counts no system row, so the unmoved watermark cannot re-fire it.
    const unprocessed = await unprocessedEntryCount('b1', 0, h.ctx)
    expect(unprocessed).toBe(0)
    expect(
      shouldCadenceFire({ status: h.status()!, unprocessedEntries: unprocessed, cadence: 1 }),
    ).toBe(false)
  })

  // Past the cap lies prose the next pass must reach, so a cut of nothing but system rows advances.
  it('advances to the cut of a truncated window of only system entries, with no call', async () => {
    const h = await ctxWith({ processedThrough: 0, headPosition: 25, entryKind: 'system' })
    const { events, result } = await drain(h.ctx)
    expect(events).toEqual([])
    expect(result).toEqual({ status: 'completed' })
    expect(generateStructured).not.toHaveBeenCalled()
    // classifierWindowMaxEntries defaults to 20.
    expect(h.watermarks).toEqual([20])
    // Nothing ran, so the lifecycle keys must not read as a successful pass.
    expect(h.status()).toMatchObject({ state: 'idle', lastSuccessAt: null })
  })

  // A failed pass's Retry can land on a window the failure's prose has left (undone), so the
  // empty pass must clear the failure it was owed for.
  it('clears a failed status when the window is empty, leaving the watermark', async () => {
    const h = await ctxWith({
      processedThrough: 3,
      headPosition: 3,
      seedStatus: { state: 'failed', lastError: 'boom' },
    })
    const { result } = await drain(h.ctx)
    expect(result).toEqual({ status: 'completed' })
    expect(generateStructured).not.toHaveBeenCalled()
    expect(h.status()).toMatchObject({
      state: 'idle',
      lastError: null,
      processedThrough: 3,
      lastSuccessAt: expect.any(Number),
    })
  })

  it('clears a failed status and advances the watermark on a truncated system-only window', async () => {
    const h = await ctxWith({
      processedThrough: 0,
      headPosition: 25,
      entryKind: 'system',
      seedStatus: { state: 'failed', lastError: 'boom' },
    })
    await drain(h.ctx)
    expect(h.status()).toMatchObject({
      state: 'idle',
      lastError: null,
      processedThrough: 20,
      lastSuccessAt: expect.any(Number),
    })
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

  // The phase can't know whether the reversal will commit, so the restore is the hook's.
  it('leaves running on an abort, for its interrupt hook to restore the status it read', async () => {
    const h = await ctxWith({
      processedThrough: 0,
      headPosition: 1,
      seedStatus: { state: 'failed', lastError: 'rate limited' },
    })
    vi.mocked(generateStructured).mockResolvedValue({ status: 'aborted' })
    const { result } = await drain(h.ctx)
    expect(result).toEqual({ status: 'aborted' })
    expect(h.status()).toMatchObject({ state: 'running', lastError: 'rate limited' })

    await interruptHook()(h.ctx)
    expect(h.status()).toEqual({
      state: 'failed',
      lastSuccessAt: null,
      lastError: 'rate limited',
      processedThrough: 0,
    })
  })

  it('restores only the lifecycle keys from its interrupt hook, never the watermark', async () => {
    const h = await ctxWith({ processedThrough: 3, headPosition: 4 })
    vi.mocked(generateStructured).mockResolvedValue({ status: 'aborted' })
    await drain(h.ctx)
    // A whole-blob restore would serialize the stashed 3 over the clamp's 1.
    h.clamp(1)
    await interruptHook()(h.ctx)
    expect(h.status()).toMatchObject({ state: 'idle', processedThrough: 1 })
  })

  it('restores nothing from its interrupt hook for a run that never read the status', async () => {
    const h = await ctxWith({
      processedThrough: 0,
      headPosition: 1,
      seedStatus: { state: 'running' },
    })
    await interruptHook()({ ...h.ctx, intermediates: {} })
    expect(h.status()).toMatchObject({ state: 'running' })
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
      lastSuccessAt: expect.any(Number),
    })
  })

  it('clears the failed state and the stale error when a pass recovers', async () => {
    const h = await ctxWith({
      processedThrough: 0,
      headPosition: 2,
      seedStatus: { state: 'failed', lastError: 'rate limited' },
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
      lastError: null,
      lastSuccessAt: expect.any(Number),
      processedThrough: 2,
    })
  })

  it('returns aborted on a cancel between its writes, keeping its last error', async () => {
    const h = await ctxWith({
      processedThrough: 0,
      headPosition: 2,
      seedStatus: { state: 'failed', lastError: 'rate limited' },
    })
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
    expect((await gen.next()).done).toBe(false)

    controller.abort()

    expect(await gen.next()).toEqual({ done: true, value: { status: 'aborted' } })
    expect(h.watermarks).toEqual([])
    expect(h.status()).toEqual({
      state: 'running',
      lastSuccessAt: null,
      lastError: 'rate limited',
      processedThrough: 0,
    })
  })

  it('returns aborted on a cancel after its last write, leaving the watermark', async () => {
    const h = await ctxWith({ processedThrough: 0, headPosition: 2 })
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: extraction({
        happenings: [{ title: 'A', sourceTurn: 't1', involvements: [], awareness: [] }],
      }),
    })
    const controller = new AbortController()
    h.ctx.abortSignal = controller.signal
    const gen = periodicClassifierPhase(h.ctx)
    expect((await gen.next()).done).toBe(false)

    controller.abort()

    expect(await gen.next()).toEqual({ done: true, value: { status: 'aborted' } })
    expect(h.watermarks).toEqual([])
    expect(h.status()).toMatchObject({ state: 'running', lastError: null, processedThrough: 0 })
  })

  it('returns aborted on a cancel after the model call, before its first write', async () => {
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
    expect(h.status()).toMatchObject({ state: 'running', lastError: null, processedThrough: 0 })
  })

  it('returns aborted with no deltas when the abort lands before parsing', async () => {
    vi.mocked(generateStructured).mockResolvedValue({ status: 'aborted' })
    const h = await ctxWith({ processedThrough: 0, headPosition: 2 })
    const { events, result } = await drain(h.ctx)
    expect(events).toEqual([])
    expect(result).toEqual({ status: 'aborted' })
    // An abort is not a failure: it records no error.
    expect(h.status()).toMatchObject({ state: 'running', lastError: null, processedThrough: 0 })
  })

  it('returns aborted on a cancel during the character reconciliation, cutting it short', async () => {
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
    const kael = {
      id: CHAR_KAEL,
      branchId: 'b1',
      kind: 'character',
      name: 'Kael',
      status: 'active',
      description: 'Kael, described.',
      keywords: [],
      state: null,
      createdAt: 1,
    } as unknown as Entity
    const h = await ctxWith({ processedThrough: 0, headPosition: 2, entities: [kael] })
    h.ctx.abortSignal = controller.signal
    const { events, result } = await drain(h.ctx)
    expect(events).toEqual([])
    expect(result).toEqual({ status: 'aborted' })
    expect(h.status()).toMatchObject({ state: 'running', processedThrough: 0 })
    expect(embedder).toHaveBeenCalledTimes(1)
  })

  // classifier.md → Failure policy: a never-answering provider expires as a failure, not an abort.
  describe('the bound on the call', () => {
    // Resolves with the fake-clock ms in flight when its signal aborts: the bound the phase armed.
    function callAbortedAfter(): Promise<number> {
      return new Promise((reportElapsed) => {
        vi.mocked(generateStructured).mockImplementation(
          (...args: unknown[]) =>
            new Promise((resolve) => {
              const signal = args[4] as AbortSignal
              const startedAt = Date.now()
              signal.addEventListener('abort', () => {
                reportElapsed(Date.now() - startedAt)
                resolve({ status: 'aborted' } as never)
              })
            }) as never,
        )
      })
    }

    async function runToExpiry(h: Harness) {
      vi.useFakeTimers()
      try {
        const elapsed = callAbortedAfter()
        const pass = drain(h.ctx)
        // Past every bound under test, so a wrong one still expires and the assertion names it.
        await vi.advanceTimersByTimeAsync(1_000_000)
        return { elapsedMs: await elapsed, ...(await pass) }
      } finally {
        vi.useRealTimers()
      }
    }

    // After ctxWith, which resets the stores.
    async function wireClassifier(timeout?: number): Promise<void> {
      const [profile] = CLASSIFIER_WIRED_CONFIG.profiles
      await hydrateAppSettings(async () => ({
        ...CLASSIFIER_WIRED_CONFIG,
        profiles: [{ ...profile, ...(timeout !== undefined ? { timeout } : {}) }],
      }))
    }

    it('fails the pass at the profile timeout, and not before', async () => {
      const h = await ctxWith({ processedThrough: 0, headPosition: 2 })
      await wireClassifier(30)

      const { elapsedMs, events, result } = await runToExpiry(h)

      expect(elapsedMs).toBe(30_000)
      expect(events).toEqual([])
      expect(result).toEqual({
        status: 'failed',
        error: { kind: 'provider', reason: 'timeout', detail: 'classifier: timeout after 30000ms' },
      })
      expect(h.watermarks).toEqual([])
      expect(h.status()).toMatchObject({
        state: 'failed',
        lastError: 'timeout after 30000ms',
        processedThrough: 0,
      })
    })

    it('lets a profile timeout run longer than ten minutes', async () => {
      const h = await ctxWith({ processedThrough: 0, headPosition: 2 })
      await wireClassifier(900)

      expect((await runToExpiry(h)).elapsedMs).toBe(900_000)
    })

    it('bounds the call at ten minutes when the profile sets no timeout', async () => {
      const h = await ctxWith({ processedThrough: 0, headPosition: 2 })
      await wireClassifier()

      const { elapsedMs, result } = await runToExpiry(h)

      expect(elapsedMs).toBe(600_000)
      expect(result).toMatchObject({ error: { detail: 'classifier: timeout after 600000ms' } })
      expect(h.status()).toMatchObject({ state: 'failed', lastError: 'timeout after 600000ms' })
    })

    // A story override names a model, not a profile, so no profile timeout reaches it.
    it("bounds a story override at ten minutes, whatever the agent's profile says", async () => {
      const h = await ctxWith({ processedThrough: 0, headPosition: 2 })
      await wireClassifier(30)
      currentStoryStore.set({
        storyId: 's1',
        branchId: 'b1',
        definition: {} as never,
        settings: {
          models: { classifier: { providerId: 'prov-1', modelId: 'other' } },
          classifierMentionedPlaces: false,
        } as never,
      })

      expect((await runToExpiry(h)).elapsedMs).toBe(600_000)
    })
  })

  it('still treats a real cancel as an abort, recording no failure', async () => {
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
    expect(h.status()).toMatchObject({ state: 'running', lastError: null })
  })

  // The timer must disarm on an outer abort, or a deliberate cancel records as a provider timeout.
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

      // Cancel just short of the ten-minute bound, then run past it while the call winds down.
      await vi.advanceTimersByTimeAsync(599_000)
      controller.abort()
      await vi.advanceTimersByTimeAsync(60_000)
      const { result } = await pass

      expect(result).toEqual({ status: 'aborted' })
      expect(h.status()).toMatchObject({ state: 'running', lastError: null })
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
    expect(result).toEqual({
      status: 'failed',
      error: { kind: 'provider', reason: 'unknown', detail: 'classifier: rate limited' },
    })
    expect(watermarks).toEqual([])
    expect(h.status()).toMatchObject({
      state: 'failed',
      lastError: 'rate limited',
      processedThrough: 0,
    })
  })

  // generation-pipeline.md → Fatal error categories: a config fault, so the reader offers its fix.
  it('fails a call whose model no longer resolves as a config-resolver error', async () => {
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'not-configured',
      kind: 'profile-missing',
    })
    const h = await ctxWith({ processedThrough: 0, headPosition: 2 })
    const { events, result } = await drain(h.ctx)
    expect(events).toEqual([])
    expect(result).toEqual({
      status: 'failed',
      error: {
        kind: 'config-resolver',
        failure: 'profile-missing',
        target: 'classifier',
        phaseName: 'classify',
        detail: 'classifier',
      },
    })
    expect(h.watermarks).toEqual([])
    expect(h.status()).toMatchObject({
      state: 'failed',
      lastError: 'profile-missing',
      processedThrough: 0,
    })
  })

  // observability.md → Record shape.
  it("logs a failed description embed under the pass's actionId and still completes", async () => {
    clearBuffers()
    configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
    configureClassifierEmbedder(async () => {
      throw new Error('embedder offline')
    })
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: extraction({
        newCharacters: [{ handle: 'nc1', name: 'Kael', description: 'A courier.', keywords: [] }],
      }),
    })
    const kael = {
      id: CHAR_KAEL,
      branchId: 'b1',
      kind: 'character',
      name: 'Kael',
      status: 'active',
      description: 'Kael, described.',
      keywords: [],
      state: null,
      createdAt: 1,
    } as unknown as Entity
    const h = await ctxWith({ processedThrough: 0, headPosition: 2, entities: [kael] })

    const { result } = await drain(h.ctx)

    expect(result).toEqual({ status: 'completed' })
    const failed = getDiagnosticsSnapshot().logEntries.filter(
      (e) => e.kind === 'classifier.description_embed_failed',
    )
    expect(failed.map((e) => [e.level, e.actionId, e.fields])).toEqual([
      ['warn', 'a1', { error: 'embedder offline' }],
    ])
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

  // The entity stores hold one branch: for another they leave an empty roster to plan against.
  it('fails when the entity stores hold another branch, before any LLM call', async () => {
    const h = await ctxWith({ processedThrough: 0, headPosition: 2 })
    entitiesStore.hydrate('b2', [])
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

  // Under the gate nothing writes the roster during the call, so the pass never re-reads it.
  describe('the roster it prompted with', () => {
    it('reconciles against it: a namesake added to the store during the call is not seen', async () => {
      const mara = {
        id: 'char_user',
        branchId: 'b1',
        kind: 'character',
        name: 'Mara',
        status: 'active',
        description: 'Mara, described.',
        keywords: [],
      } as unknown as Entity
      vi.mocked(generateStructured).mockImplementation(async () => {
        entitiesStore.hydrate('b1', [mara])
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
        name: 'Mara',
        nameCollisionFlag: 0,
        nameCollisionPartnerId: null,
      })
    })

    it('plans against it: a place added to the store during the call is created, not reused', async () => {
      const varn = {
        id: 'loc_varn',
        branchId: 'b1',
        kind: 'location',
        name: 'Varn',
        status: 'active',
        description: 'Varn, described.',
        keywords: [],
        state: { parent_location_id: null },
        createdAt: 1,
      } as unknown as Entity
      vi.mocked(generateStructured).mockImplementation(async () => {
        entitiesStore.hydrate('b1', [varn])
        return {
          status: 'ok',
          value: extraction({
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
          }),
        }
      })
      const h = await ctxWith({ processedThrough: 0, headPosition: 2, mentionedPlaces: true })
      const { events, result } = await drain(h.ctx)

      expect(result).toEqual({ status: 'completed' })
      const created = createdEntry(events)
      expect(created).toMatchObject({ kind: 'location', name: 'Varn' })
      expect(created?.id).not.toBe('loc_varn')
      const involvement = events
        .map((e) => (e as { action: PipelineAction }).action)
        .find((a) => a.kind === 'createHappeningInvolvement')
      expect(involvement?.payload).toMatchObject({ entry: { entityId: created?.id } })
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
      state: { faction_id: null },
    } as unknown as Entity
    const h = await ctxWith({ processedThrough: 0, headPosition: 2, entities: [kael] })
    const { events } = await drain(h.ctx)

    const actions = events.map((e) => (e as { action: { kind: string; payload: unknown } }).action)
    expect(actions.map((a) => a.kind)).toEqual(['appendEntityKeywords'])
    expect(actions[0].payload).toMatchObject({ id: CHAR_KAEL, keywords: ['the courier'] })
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

  it('writes its status key-scoped and its watermark MAX-guarded', async () => {
    const h = await ctxWith({ processedThrough: 0, headPosition: 2 })
    vi.mocked(generateStructured).mockImplementation(async () => {
      // Stands in for the column's other writer, the reversal clamp, which the gate keeps out of a
      // running pass: this pins only how the pass writes the column.
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

  it('declares a gated, interruptible pass with the banner and its blockers', () => {
    ensurePeriodicClassifierPipelineRegistered()
    const pipeline = getPipeline(PERIODIC_CLASSIFIER_KIND)
    expect(pipeline).toMatchObject({
      gateBehavior: 'hard-gate',
      interruptible: 'pass',
      affordance: 'pill-and-banner',
      concurrencyPolicy: {
        blockedBy: [PER_TURN_KIND, PERIODIC_CLASSIFIER_KIND, 'chapter-close', 'translation-retry'],
      },
    })
    // Passes chain one another only for a pending close (M5.2); none chains here.
    expect(pipeline.chainsTo).toBeUndefined()
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

    it('logs and drops a membership naming a faction retired before the reply', async () => {
      clearBuffers()
      configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
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
          { ...row(FACT_CIRCLE, 'faction', 'The Iron Circle'), status: 'retired' },
        ],
      })
      const { events } = await drain(h.ctx)

      expect(actionsOf(events)).toEqual([])
      const logs = getDiagnosticsSnapshot().logEntries.filter(
        (e) => e.kind === 'classifier.membership_dropped',
      )
      expect(logs.map((e) => [e.level, e.fields])).toEqual([
        ['warn', { character: CHAR_KAEL, faction: FACT_CIRCLE, cause: 'retired-faction' }],
      ])
    })
  })
})

// Not drain(): it skips the action layer and the orchestrator's abort reversal.
describe('periodicClassifierPhase via runPipeline', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    __resetRegistry()
    __resetClassifierEmbedder()
    __resetBranchWriteLocks()
  })

  function configurePort(
    applyDeltaAction: DeltaActionPort['applyDeltaAction'] = realApplyDeltaAction,
  ): void {
    configureDeltaActionPort({
      applyDeltaAction,
      reverseReplayDeltas,
      describeReplayError: describeDeltaReplayError,
      settleUserWrites,
      holdBranchWriteExclusive,
      releaseBranchWriteExclusive,
    })
  }

  afterEach(() => configurePort())

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
    configurePort((args, applyCtx) => {
      if (args.action.kind !== 'createHappening') return realApplyDeltaAction(args, applyCtx)
      onReject?.()
      return Promise.resolve({ status: 'rejected', reason: 'forced test rejection' })
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

  const FAILED: ClassifierStatus = {
    state: 'failed',
    lastSuccessAt: null,
    lastError: 'rate limited',
    processedThrough: 0,
  }

  async function seedStatus(db: TestDb['db'], status: ClassifierStatus): Promise<void> {
    await db.update(branches).set({ classifierStatus: status }).where(eq(branches.id, 'b1'))
  }

  type Chunk = { value?: unknown; queryChunks?: Chunk[] } | null
  const sqlText = (query: Chunk): string =>
    (query?.queryChunks ?? [])
      .map((chunk) => (Array.isArray(chunk?.value) ? chunk.value.join('') : sqlText(chunk)))
      .join('')

  // Resolves once the model call is in flight; the call itself ends only on an abort.
  function holdModelCall(): Promise<void> {
    let calling!: () => void
    const inCall = new Promise<void>((resolve) => {
      calling = resolve
    })
    vi.mocked(generateStructured).mockImplementation(
      (...args: unknown[]) =>
        new Promise((resolve) => {
          const signal = args[4] as AbortSignal
          signal.addEventListener('abort', () => resolve({ status: 'aborted' } as never))
          calling()
        }) as never,
    )
    return inCall
  }

  it('routes a write the action layer rejects to the failed status instead of leaving running stuck', async () => {
    const { db, runInTransaction } = await seedApplyTimeHarness()

    // Stands in for any action-layer rejection; the guard must recover from each the same way.
    rejectCreateHappening()
    registerWithReply()

    expect(await runOutcome({ storyId: 's1', branchId: 'b1', db, runInTransaction })).toBe('failed')

    const status = await storedStatus(db)
    expect(status).toMatchObject({ state: 'failed' })
    expect(status?.lastError).toBe('classifier: forced test rejection')
  })

  // observability.md → Record shape.
  it('still reaches the failed status when the first failure write fails, logging the retry as the run', async () => {
    clearBuffers()
    configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
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

    // No actionId passed: the hook must hand on the run's own, which only the run knows.
    const result = await runPipeline(PERIODIC_CLASSIFIER_KIND, {
      storyId: 's1',
      branchId: 'b1',
      db: flaky,
      runInTransaction,
    })
    if (result.outcome === 'rejected') throw new Error('unexpected rejected start')

    expect(result.outcome).toBe('failed')
    expect(await storedStatus(db)).toMatchObject({
      state: 'failed',
      lastError: 'classifier: forced test rejection',
    })
    const retried = getDiagnosticsSnapshot().logEntries.filter(
      (e) => e.kind === 'classifier.failure_record_retried',
    )
    expect(retried.map((e) => e.actionId)).toEqual([result.actionId])
  })

  it('counts a pass whose watermark write fails as a failure, not a success', async () => {
    const { db, runInTransaction } = await seedApplyTimeHarness()
    await db.run(
      sql`UPDATE branches SET classifier_status = ${JSON.stringify({
        state: 'failed',
        lastSuccessAt: null,
        lastError: 'rate limited',
        processedThrough: 0,
      })} WHERE id = 'b1'`,
    )
    let failWatermark = true
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

    // The seeded error replaced: the failure was recorded, not just left over.
    expect(await storedStatus(db)).toMatchObject({
      state: 'failed',
      lastError: 'classifier: SQLITE_FULL',
      lastSuccessAt: null,
      processedThrough: 0,
    })
  })

  // A failed reversal leaves the write on disk, so a retry at the next turn would re-read it.
  // `running` stays, holding the cadence, for boot's resetStuckClassifierRunState.
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

    expect(await storedStatus(db)).toMatchObject({ state: 'running', lastError: null })
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
      lastError: null,
    })
  })

  it('commits nothing and keeps its pre-run status when interrupted during the model call', async () => {
    const { db, runInTransaction } = await seedApplyTimeHarness()
    await seedStatus(db, FAILED)
    ensurePeriodicClassifierPipelineRegistered()
    const inCall = holdModelCall()

    const pass = runOutcome({ storyId: 's1', branchId: 'b1', db, runInTransaction })
    await inCall
    await interruptMemoryRuns('b1')

    expect(await pass).toBe('aborted')
    expect(await db.select().from(deltas)).toEqual([])
    expect(await storedStatus(db)).toEqual(FAILED)
    expect(generationStore.getTxState().deferred.get('b1')).toEqual({ pass: true })
  })

  // Left `running`, the cadence would stay suspended for the rest of the session.
  it('retries a status restore that fails once after an interrupt, logging it as the run', async () => {
    clearBuffers()
    configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
    const { db, runInTransaction } = await seedApplyTimeHarness()
    await seedStatus(db, FAILED)
    ensurePeriodicClassifierPipelineRegistered()
    const inCall = holdModelCall()
    let failRestore = false
    const flaky = new Proxy(db, {
      get(target, prop) {
        if (prop === 'run')
          return (...args: Parameters<typeof db.run>) => {
            if (failRestore && sqlText(args[0] as Chunk).includes("'$.state'")) {
              failRestore = false
              throw new Error('SQLITE_BUSY')
            }
            return target.run(...args)
          }
        const value = Reflect.get(target, prop, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })

    const pass = runOutcome({ storyId: 's1', branchId: 'b1', db: flaky, runInTransaction })
    await inCall
    const [held] = generationStore.getTxState().runs.values()
    failRestore = true
    await interruptMemoryRuns('b1')

    expect(await pass).toBe('aborted')
    expect(failRestore).toBe(false)
    expect(await storedStatus(db)).toEqual(FAILED)
    const retried = getDiagnosticsSnapshot().logEntries.filter(
      (e) => e.kind === 'classifier.interrupt_restore_retried',
    )
    expect(retried.map((e) => e.actionId)).toEqual([held.actionId])
  })

  // generation-pipeline.md → Prose reversals and the interrupt: the restore lands before the sweep.
  it('restores its status when a prose reversal interrupts it, under the clamp the sweep lands', async () => {
    const { db, runInTransaction } = await seedStory()
    for (const position of [1, 2, 3, 4])
      await db.insert(storyEntries).values({
        id: `e${position}`,
        branchId: 'b1',
        position,
        kind: 'ai_reply',
        content: `turn ${position}`,
        chapterId: null,
        metadata: {},
        createdAt: 1,
      } as never)
    const preRun: ClassifierStatus = { ...FAILED, processedThrough: 3 }
    await seedStatus(db, preRun)
    ensurePeriodicClassifierPipelineRegistered()
    const inCall = holdModelCall()

    const pass = runOutcome({ storyId: 's1', branchId: 'b1', db, runInTransaction })
    await inCall
    await bracketProseReversal('b1', () => runInTransaction(classifierWatermarkClampOps('b1', 3)))

    expect(await pass).toBe('aborted')
    expect(generationStore.getTxState().runs.size).toBe(0)
    expect(generationStore.getTxState().deferred.get('b1')).toEqual({ pass: true })
    expect(await storedStatus(db)).toEqual({ ...preRun, processedThrough: 2 })
  })

  it('reverses what it wrote when interrupted mid-burst, keeping its status and watermark', async () => {
    const { db, runInTransaction } = await seedApplyTimeHarness()
    await seedStatus(db, FAILED)
    let interrupted = false
    configurePort(async (args, applyCtx) => {
      const result = await realApplyDeltaAction(args, applyCtx)
      // Awaiting the interrupt here would deadlock: the run waits on this write.
      if (!interrupted && args.action.kind === 'createHappening') {
        interrupted = true
        for (const run of generationStore.getTxState().runs.values()) run.abortController.abort()
      }
      return result
    })
    registerWithReply({
      happenings: [
        { title: 'A', sourceTurn: 't1', involvements: [], awareness: [] },
        { title: 'B', sourceTurn: 't1', involvements: [], awareness: [] },
      ],
    })

    expect(await runOutcome({ storyId: 's1', branchId: 'b1', db, runInTransaction })).toBe(
      'aborted',
    )
    expect(interrupted).toBe(true)
    expect(await db.select().from(happenings)).toEqual([])
    expect(await db.select().from(deltas)).toEqual([])
    expect(await storedStatus(db)).toEqual(FAILED)
    expect(generationStore.getTxState().deferred.get('b1')).toEqual({ pass: true })
  })

  // generation-pipeline.md → Recovery-failure policy: the writes stay, so the cadence stays shut.
  it('leaves running when interrupted mid-burst and its reversal cannot commit', async () => {
    const { db, runInTransaction } = await seedApplyTimeHarness()
    await seedStatus(db, FAILED)
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
    let interrupted = false
    configurePort(async (args, applyCtx) => {
      const result = await realApplyDeltaAction(args, applyCtx)
      if (!interrupted && args.action.kind === 'createHappening') {
        interrupted = true
        for (const run of generationStore.getTxState().runs.values()) run.abortController.abort()
      }
      return result
    })
    registerWithReply({
      happenings: [
        { title: 'A', sourceTurn: 't1', involvements: [], awareness: [] },
        { title: 'B', sourceTurn: 't1', involvements: [], awareness: [] },
      ],
    })

    expect(
      await runOutcome({
        storyId: 's1',
        branchId: 'b1',
        db,
        runInTransaction,
        actionId: fixedActionId,
      }),
    ).toBe('failed')
    expect(interrupted).toBe(true)
    expect((await db.select().from(happenings)).map((h) => h.title)).toEqual(['A'])
    expect(await storedStatus(db)).toEqual({ ...FAILED, state: 'running' })
    expect(generationStore.getTxState().deferred.get('b1')).toBeUndefined()
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

describe('passTimeoutMs', () => {
  const [profile] = CLASSIFIER_WIRED_CONFIG.profiles
  const config = (timeout?: number): ResolveModelConfig => ({
    providers: CLASSIFIER_WIRED_CONFIG.providers,
    profiles: [{ ...profile, ...(timeout !== undefined ? { timeout } : {}) }],
    assignments: CLASSIFIER_WIRED_CONFIG.assignments,
  })

  // Profile timeouts are seconds, as the SDK call settings read them.
  it("reads the classifier profile's timeout, shorter or longer than ten minutes", () => {
    expect(passTimeoutMs(config(30))).toBe(30_000)
    expect(passTimeoutMs(config(900))).toBe(900_000)
  })

  it('is ten minutes when the profile sets none, the chain does not resolve, or a story overrides', () => {
    expect(passTimeoutMs(config())).toBe(600_000)
    expect(passTimeoutMs({ ...config(30), assignments: {} })).toBe(600_000)
    expect(
      passTimeoutMs({
        ...config(30),
        storyModels: { classifier: { providerId: 'prov-1', modelId: 'other' } },
      }),
    ).toBe(600_000)
  })
})
