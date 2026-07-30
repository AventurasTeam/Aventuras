import { beforeEach, describe, expect, it, vi } from 'vitest'

import { generateStructured } from '@/lib/ai'
import { shouldCadenceFire } from '@/lib/classifier'
import { branches, stories, type ClassifierStatus, type Entity, type StoryEntry } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { makeLogger } from '@/lib/diagnostics'
import {
  currentStoryStore,
  entitiesStore,
  entriesStore,
  happeningsStore,
  resetAllStores,
} from '@/lib/stores'

import {
  __resetClassifierEmbedder,
  configureClassifierEmbedder,
  ensurePeriodicClassifierPipelineRegistered,
  PERIODIC_CLASSIFIER_KIND,
  PERIODIC_CLASSIFIER_RESOLVES,
  periodicClassifierPhase,
} from './periodic-classifier'
import { __resetRegistry, getPipeline } from '../authoring/registry'
import type { PhaseContext } from '../types'

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: vi.fn(),
}))

const CHAR_KAEL = 'char_11111111-1111-1111-1111-111111111111'

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
  seedStatus?: Partial<ClassifierStatus>
  onWatermark?: (n: number) => void
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

  resetAllStores()
  currentStoryStore.set({
    storyId: 's1',
    branchId: 'b1',
    definition: {} as never,
    settings: { models: {} } as never,
  })
  entriesStore.hydrate('b1', entries)
  entitiesStore.hydrate('b1', opts.entities ?? [])
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

  it('advances past a window of only system entries, so the cadence cannot live-lock', async () => {
    const h = await ctxWith({ processedThrough: 0, headPosition: 2, entryKind: 'system' })
    const { events, result } = await drain(h.ctx)
    expect(events).toEqual([])
    expect(result).toEqual({ status: 'completed' })
    expect(generateStructured).not.toHaveBeenCalled()
    // Technical rows hold positions the model must never see; leaving the
    // watermark behind them re-fires the cadence on every run_complete forever.
    expect(h.status()?.processedThrough).toBe(2)
    expect(shouldCadenceFire({ status: h.status()!, headPosition: 2, cadence: 1 })).toBe(false)
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

  it('is abort-free once parsing begins: an abort mid-burst still commits and returns completed', async () => {
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
    expect(events).toHaveLength(1)
    expect(result).toEqual({ status: 'completed' })
    expect(h.status()?.processedThrough).toBe(2)
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

  it('fails when the entries store holds another branch', async () => {
    const h = await ctxWith({ processedThrough: 0, headPosition: 2 })
    entriesStore.hydrate('other', [])
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
    } as unknown as Entity
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: extraction({
        newCharacters: [{ handle: 'nc1', name: 'kael', description: 'The courier from the ford.' }],
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
      'updateEntity',
      'createHappening',
      'createHappeningInvolvement',
    ])
    expect(actions[0].payload).toMatchObject({ id: CHAR_KAEL, patch: { status: 'active' } })
    expect(actions[2].payload).toMatchObject({ entry: { entityId: CHAR_KAEL } })
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
})
