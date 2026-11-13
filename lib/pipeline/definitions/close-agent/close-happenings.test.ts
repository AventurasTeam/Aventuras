import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResolveModelConfig } from '@/lib/ai'
import {
  clearEmbeddingStaleOp,
  entities,
  happeningInvolvements,
  happenings,
  lore,
  packFloat32,
  sourceHash,
  upsertVecOps,
  vecTableName,
  type EmbeddedFieldRow,
  type SqlOp,
} from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'
import { EmbedderCallError, EmbedderCancelledError, EmbedderInitError } from '@/lib/embedder'
import { resetAllStores, storiesStore } from '@/lib/stores'

import { __setCloseEmbedDepsForTest, embedRangeStep, type CloseEmbedDeps } from './close-happenings'
import { CloseIds } from './ids'
import { __setCloseAgentSlots, type CodeStepContext } from './slots'
import type { CloseTaskDef } from './task'
import type { PhaseContext, PhaseResult } from '../../types'
import { openCloseFixture, queryAllOn, type CloseFixture } from '../__tests__/close-fixture'
import { closeAgentPhase } from '../chapter-close-agent'
import { closeClustersOf, setCloseParts, setCloseRange } from '../close-intermediates'

const DIM = 384 // the dim family the migrations create
const MODEL = 'test-embed-model'
const ACTION_ID = 'act_range_embed'
const CONFIG: ResolveModelConfig = { providers: [], profiles: [], assignments: {} }

const H1 = 'hap_00000000-0000-4000-8000-0000000000a1'
const H2 = 'hap_00000000-0000-4000-8000-0000000000a2'
const H3 = 'hap_00000000-0000-4000-8000-0000000000a3'
const H_LATER = 'hap_00000000-0000-4000-8000-0000000000a9'
const TOLL_LAW = 'lore_00000000-0000-4000-8000-0000000000b1'
const WREN = 'char_00000000-0000-4000-8000-000000000001'
const TOBIN = 'char_00000000-0000-4000-8000-000000000002'
const MIRA = 'char_00000000-0000-4000-8000-000000000003'
const FERRY = 'loc_00000000-0000-4000-8000-000000000004'
const LANTERN = 'item_00000000-0000-4000-8000-000000000005'
const CAST = [
  { id: WREN, kind: 'character', name: 'Wren' },
  { id: TOBIN, kind: 'character', name: 'Tobin' },
  { id: MIRA, kind: 'character', name: 'Mira' },
  { id: FERRY, kind: 'location', name: 'The ferry' },
  { id: LANTERN, kind: 'item', name: 'The lantern' },
] as const

let fx: CloseFixture
const vectors = new Map<string, Float32Array>()

// The chapter: the opening to the third reply, positions 1-7; E is that reply.
const chapterEntryIds = (): string[] => fx.entries.slice(0, 7).map(({ id }) => id)
const endEntryId = (): string => fx.entries[6]!.id

/** A unit vector at `angle` radians in its first two dims: two rows' cosine is cos of the gap. */
function unitAt(angle: number): Float32Array {
  const vector = new Float32Array(DIM)
  vector[0] = Math.cos(angle)
  vector[1] = Math.sin(angle)
  return vector
}

// A real embed's commit for a row: its vector, guarded on the text it was computed from.
function vecWrite(row: EmbeddedFieldRow): SqlOp[] {
  const vector = vectors.get(row.id)
  if (vector === undefined) throw new Error(`no vector scripted for ${row.id}`)
  return upsertVecOps(
    {
      kind: 'happening',
      id: row.id,
      branchId: row.branchId,
      modelId: MODEL,
      dim: DIM,
      sourceHash: sourceHash(row.fields.join(' ')),
      vector: packFloat32(vector),
    },
    { fields: row.fields },
  )
}

const embedOps = (rows: readonly EmbeddedFieldRow[]): SqlOp[] =>
  rows.flatMap((row) => [...vecWrite(row), clearEmbeddingStaleOp(row)])

type Seed = {
  id: string
  title: string
  /** The entry it occurred at; null for a temporal row. */
  at: string | null
  cast: readonly string[]
  vector: Float32Array
  /** Already embedded: a stored vector and a clear flag. */
  embedded?: boolean
}

async function seedHappening({ id, title, at, cast, vector, embedded = false }: Seed) {
  vectors.set(id, vector)
  const description = `${title}, as the turn tells it.`
  await fx.ctx.db.insert(happenings).values({
    id,
    branchId: fx.branchId,
    title,
    description,
    occurredAtEntryId: at,
    createdAt: 1,
    updatedAt: 1,
    embeddingStale: embedded ? 0 : 1,
  })
  if (cast.length > 0)
    await fx.ctx.db.insert(happeningInvolvements).values(
      cast.map((entityId, i) => ({
        id: `hinv_${id.slice(-2)}_${i}`,
        branchId: fx.branchId,
        happeningId: id,
        entityId,
        role: null,
      })),
    )
  if (embedded)
    await fx.ctx.runInTransaction(
      vecWrite({ kind: 'happening', id, branchId: fx.branchId, fields: [title, description] }),
    )
}

// Two crossing beats one entry apart, the same pair on stage: what 3e merges.
async function seedPair(over: { h1?: Partial<Seed>; h2?: Partial<Seed> } = {}): Promise<void> {
  await seedHappening({
    id: H1,
    title: 'Tobin names his price',
    at: fx.entries[3]!.id,
    cast: [WREN, TOBIN],
    vector: unitAt(0),
    ...over.h1,
  })
  await seedHappening({
    id: H2,
    title: 'Wren pays the fare',
    at: fx.entries[4]!.id,
    cast: [WREN, TOBIN],
    vector: unitAt(0.2),
    ...over.h2,
  })
}

type Embed = (rows: EmbeddedFieldRow[], signal?: AbortSignal) => Promise<SqlOp[]>

/** Installs scripted embed deps on the fixture db; records each call's row ids. */
function script(
  embed: Embed = async (rows) => embedOps(rows),
  queryAll: CloseEmbedDeps['queryAll'] = queryAllOn(fx.ctx.db),
) {
  const embedded: string[][] = []
  const revalidated: string[][] = []
  const deps: CloseEmbedDeps = {
    queryAll,
    modelId: MODEL,
    dim: DIM,
    revalidateRows: async (rows) => {
      revalidated.push(rows.map(({ id }) => id))
      return { staleRows: rows, freshOps: [] }
    },
    embedRows: async (rows, signal) => {
      embedded.push(rows.map(({ id }) => id))
      return embed(rows, signal)
    },
  }
  __setCloseEmbedDepsForTest(deps)
  return { embedded, revalidated }
}

function phaseOf(over: Partial<PhaseContext> = {}): PhaseContext {
  return {
    actionId: ACTION_ID,
    abortSignal: new AbortController().signal,
    intermediates: {},
    log: makeLogger(ACTION_ID),
    db: fx.ctx.db,
    runInTransaction: fx.ctx.runInTransaction,
    storyId: fx.storyId,
    branchId: fx.branchId,
    ...over,
  }
}

// What closeAgentPhase hands a `before` step: part 0, the chapter's non-system entries.
function stepContext(phase: PhaseContext): CodeStepContext {
  return {
    db: phase.db,
    branchId: phase.branchId,
    endEntryId: endEntryId(),
    part: 0,
    taskEntryIds: chapterEntryIds(),
    ids: new CloseIds(),
    survivorOf: () => undefined,
    landedCalls: () => 0,
    clusterOf: () => undefined,
    phase,
    config: CONFIG,
  }
}

async function runStep(phase: PhaseContext): Promise<PhaseResult> {
  const next = await embedRangeStep.run(stepContext(phase)).next()
  if (!next.done) throw new Error(`the range embed emitted ${next.value.type}`)
  return next.value
}

async function staleOf(): Promise<Record<string, number>> {
  const rows = await fx.ctx.db
    .select({ id: happenings.id, stale: happenings.embeddingStale })
    .from(happenings)
    .where(eq(happenings.branchId, fx.branchId))
  return Object.fromEntries(rows.map(({ id, stale }) => [id, stale]))
}

async function storedVectorIds(): Promise<string[]> {
  const rows = await queryAllOn(fx.ctx.db)(
    `SELECT id FROM ${vecTableName('happening', DIM)} WHERE branch_id = ?`,
    [fx.branchId],
  )
  return rows.map(([id]) => String(id)).sort()
}

beforeEach(async () => {
  fx = await openCloseFixture()
  // The cast is read through the entities join, so every involvement's entity is a real row.
  await fx.ctx.db.insert(entities).values(
    CAST.map(({ id, kind, name }) => ({
      id,
      branchId: fx.branchId,
      kind,
      name,
      status: 'active' as const,
      injectionMode: 'auto' as const,
      createdAt: 1,
      updatedAt: 1,
    })),
  )
})

afterEach(() => {
  vi.useRealTimers()
  __setCloseEmbedDepsForTest(undefined)
  __setCloseAgentSlots(undefined)
  vectors.clear()
  resetAllStores()
})

describe('the range embed', () => {
  it('embeds only the stale happenings anchored in the chapter, leaving every other row stale', async () => {
    await seedPair()
    // Close enough to cluster with the pair, had it been in range: past E, it isn't.
    await seedHappening({
      id: H_LATER,
      title: 'A second lantern',
      at: fx.entries[9]!.id,
      cast: [WREN, TOBIN],
      vector: unitAt(0.1),
    })
    await fx.ctx.db.insert(lore).values({
      id: TOLL_LAW,
      branchId: fx.branchId,
      title: 'The toll law',
      body: 'Pay at the river.',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    })
    const { embedded } = script()
    const phase = phaseOf()

    expect(await runStep(phase)).toEqual({ status: 'completed' })

    expect(embedded.map((ids) => [...ids].sort())).toEqual([[H1, H2]])
    expect(await staleOf()).toEqual({ [H1]: 0, [H2]: 0, [H_LATER]: 1 })
    const [toll] = await fx.ctx.db
      .select({ stale: lore.embeddingStale })
      .from(lore)
      .where(and(eq(lore.branchId, fx.branchId), eq(lore.id, TOLL_LAW)))
    expect(toll?.stale).toBe(1)
    expect(await storedVectorIds()).toEqual([H1, H2])
    expect(closeClustersOf(phase.intermediates)).toEqual([[H1, H2]])
  })

  it('reads back a stored vector, so a row embedded earlier clusters with a fresh one', async () => {
    await seedPair({ h1: { embedded: true } })
    const { embedded, revalidated } = script()
    const phase = phaseOf()

    expect(await runStep(phase)).toEqual({ status: 'completed' })

    expect(revalidated).toEqual([[H2]])
    expect(embedded).toEqual([[H2]])
    expect(closeClustersOf(phase.intermediates)).toEqual([[H1, H2]])
  })

  it.each([
    { name: 'anchors five entries apart', h2: { at: 6, cast: [WREN, TOBIN] } },
    { name: 'casts that share nothing', h2: { at: 4, cast: [MIRA] } },
  ])('embeds but clusters nothing for two rows with $name', async ({ h2 }) => {
    await seedPair({
      h1: { at: fx.entries[1]!.id },
      h2: { at: fx.entries[h2.at]!.id, cast: h2.cast },
    })
    const { embedded } = script()
    const phase = phaseOf()

    expect(await runStep(phase)).toEqual({ status: 'completed' })

    expect(embedded.map((ids) => [...ids].sort())).toEqual([[H1, H2]])
    expect(closeClustersOf(phase.intermediates)).toEqual([])
  })

  it.each([
    { name: 'only a place and an item', h1: [FERRY, LANTERN], h2: [FERRY, LANTERN] },
    {
      name: 'a place and an item but no character',
      h1: [WREN, FERRY, LANTERN],
      h2: [TOBIN, FERRY, LANTERN],
    },
  ])('clusters nothing for two rows sharing $name: the cast is characters only', async (casts) => {
    await seedPair({ h1: { cast: casts.h1 }, h2: { cast: casts.h2 } })
    const { embedded } = script()
    const phase = phaseOf()

    expect(await runStep(phase)).toEqual({ status: 'completed' })

    expect(embedded.map((ids) => [...ids].sort())).toEqual([[H1, H2]])
    expect(closeClustersOf(phase.intermediates)).toEqual([])
  })

  it('makes no embedder call and parks no cluster for a chapter with one happening', async () => {
    await seedHappening({
      id: H1,
      title: 'Tobin names his price',
      at: fx.entries[3]!.id,
      cast: [WREN, TOBIN],
      vector: unitAt(0),
    })
    await seedHappening({
      id: H_LATER,
      title: 'A second lantern',
      at: fx.entries[9]!.id,
      cast: [WREN, TOBIN],
      vector: unitAt(0.1),
    })
    const { embedded, revalidated } = script()
    const phase = phaseOf()

    expect(await runStep(phase)).toEqual({ status: 'completed' })

    expect(embedded).toEqual([])
    expect(revalidated).toEqual([])
    expect(closeClustersOf(phase.intermediates)).toEqual([])
    expect(await staleOf()).toEqual({ [H1]: 1, [H_LATER]: 1 })
  })

  it('needs no embedder at all for a chapter with one happening', async () => {
    await seedHappening({
      id: H1,
      title: 'Tobin names his price',
      at: fx.entries[3]!.id,
      cast: [WREN, TOBIN],
      vector: unitAt(0),
    })

    // No scripted deps, and no story to resolve one from: nothing reaches resolution.
    expect(await runStep(phaseOf({ storyId: null }))).toEqual({ status: 'completed' })
  })

  it('returns aborted when the run is stopped mid-embed, parking no cluster', async () => {
    await seedPair()
    const stop = new AbortController()
    script(async () => {
      stop.abort()
      throw new EmbedderCancelledError('embed cancelled')
    })
    const phase = phaseOf({ abortSignal: stop.signal })

    expect(await runStep(phase)).toEqual({ status: 'aborted' })

    expect(closeClustersOf(phase.intermediates)).toEqual([])
    expect(await staleOf()).toEqual({ [H1]: 1, [H2]: 1 })
  })

  it('reads an embedder that cancels unasked, inside the bound, as a stop', async () => {
    await seedPair()
    script(async () => {
      throw new EmbedderCancelledError('embed cancelled')
    })
    const phase = phaseOf()

    expect(await runStep(phase)).toEqual({ status: 'aborted' })

    expect(phase.abortSignal.aborted).toBe(false)
    expect(closeClustersOf(phase.intermediates)).toEqual([])
  })

  it('returns aborted when the stop lands as the embed completes', async () => {
    await seedPair()
    const stop = new AbortController()
    script(async (rows) => {
      stop.abort()
      return embedOps(rows)
    })
    const phase = phaseOf({ abortSignal: stop.signal })

    expect(await runStep(phase)).toEqual({ status: 'aborted' })

    expect(closeClustersOf(phase.intermediates)).toEqual([])
  })

  it.each([
    {
      name: 'a call failure',
      error: () => new EmbedderCallError('provider down'),
      reason: 'call',
      detail: 'provider down',
    },
    {
      name: 'an init failure',
      error: () => new EmbedderInitError('model missing'),
      reason: 'init',
      detail: 'model missing',
    },
  ])('fails the close on $name, with its reason and the stale count', async (failure) => {
    await seedPair()
    script(async () => {
      throw failure.error()
    })
    const phase = phaseOf()

    expect(await runStep(phase)).toEqual({
      status: 'failed',
      error: { kind: 'embedder', reason: failure.reason, detail: failure.detail, staleCount: 2 },
    })

    expect(closeClustersOf(phase.intermediates)).toEqual([])
    expect(await staleOf()).toEqual({ [H1]: 1, [H2]: 1 })
  })

  it('fails the close as an unconfigured embedder when the run has no story', async () => {
    await seedPair()

    expect(await runStep(phaseOf({ storyId: null }))).toEqual({
      status: 'failed',
      error: {
        kind: 'embedder',
        reason: 'init',
        detail: 'embedder not configured: the close has no story',
        staleCount: null,
      },
    })
  })

  it("fails the close as an unconfigured embedder when the story isn't loaded", async () => {
    await seedPair()
    // The fixture opens the story without listing it in the stories store.
    expect(storiesStore.getStories().rows).toEqual([])

    expect(await runStep(phaseOf())).toEqual({
      status: 'failed',
      error: {
        kind: 'embedder',
        reason: 'init',
        detail: `embedder not configured: story ${fx.storyId} isn't loaded`,
        staleCount: null,
      },
    })
  })
})

describe('the range embed bound', () => {
  it.each([
    {
      name: 'a call failure',
      error: () => new EmbedderCallError('embed timed out'),
      staleCount: 2,
    },
    {
      name: 'a cancel',
      error: () => new EmbedderCancelledError('embed cancelled'),
      staleCount: null,
    },
  ])(
    'fails the close, naming the 300 s bound, when the embed outlives it and ends in $name',
    async ({ error, staleCount }) => {
      await seedPair()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      script(async (_rows, signal) => {
        vi.advanceTimersByTime(300_000)
        if (signal?.aborted !== true) throw new Error('expected the bound to have fired')
        throw error()
      })

      expect(await runStep(phaseOf())).toEqual({
        status: 'failed',
        error: {
          kind: 'embedder',
          reason: 'call',
          detail: 'embed timed out after 300000ms',
          staleCount,
        },
      })
    },
  )

  it('disposes the bound once the embed ends', async () => {
    await seedPair()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let armed = -1
    script(async (rows) => {
      armed = vi.getTimerCount()
      return embedOps(rows)
    })

    expect(await runStep(phaseOf())).toEqual({ status: 'completed' })

    expect(armed).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('a stored vector the model cannot use', () => {
  it('fails the close as an embedder failure on a stored vector that is not unit-norm', async () => {
    const doubled = unitAt(0).map((x) => x * 2)
    await seedPair({ h1: { embedded: true, vector: doubled } })
    script()
    const phase = phaseOf()

    expect(await runStep(phase)).toEqual({
      status: 'failed',
      error: {
        kind: 'embedder',
        reason: 'init',
        detail: expect.stringContaining('not unit-norm'),
        staleCount: null,
      },
    })

    expect(closeClustersOf(phase.intermediates)).toEqual([])
  })

  it('fails the close as an embedder failure on a stored blob that is no vector', async () => {
    await seedPair()
    const read = queryAllOn(fx.ctx.db)
    script(undefined, async (query, params) => {
      const rows = await read(query, params)
      return query.startsWith('SELECT id, embedding')
        ? rows.map(([id]) => [id, new Uint8Array(3)])
        : rows
    })

    expect(await runStep(phaseOf())).toEqual({
      status: 'failed',
      error: {
        kind: 'embedder',
        reason: 'init',
        detail: 'Invalid vector blob length: 3',
        staleCount: null,
      },
    })
  })

  it('lets a fault outside that family escape, never offering an embedder switch for it', async () => {
    await seedPair()
    const read = queryAllOn(fx.ctx.db)
    script(undefined, async (query, params) => {
      if (query.startsWith('SELECT id, embedding')) throw new Error('database is locked')
      return read(query, params)
    })

    await expect(runStep(phaseOf())).rejects.toThrow('database is locked')
  })
})

describe("the clusters on the close's context", () => {
  it('reach a task through clusterOf, though its context was built before the embed ran', async () => {
    await seedPair()
    await seedHappening({
      id: H3,
      title: 'The storm breaks',
      at: fx.entries[5]!.id,
      cast: [MIRA],
      vector: unitAt(2),
    })
    script()
    const seen: (readonly string[] | undefined)[] = []
    const probe: CloseTaskDef & { task: 'happenings' } = {
      task: 'happenings',
      tools: [],
      readFields: {},
      start: async (ctx) => {
        seen.push(ctx.clusterOf(H1), ctx.clusterOf(H3))
        return null
      },
      render: () => {
        throw new Error('the probe task rendered')
      },
    }
    __setCloseAgentSlots({
      before: [
        { kind: 'code', step: embedRangeStep },
        { kind: 'task', def: probe },
      ],
      perPart: [],
      after: [],
    })
    const phase = phaseOf()
    setCloseRange(phase.intermediates, {
      chapterId: 'chap_range_embed',
      startEntryId: fx.entries[0]!.id,
      endEntryId: endEntryId(),
    })
    setCloseParts(phase.intermediates, [
      { part: 1, startEntryId: fx.entries[0]!.id, endEntryId: endEntryId(), tokens: 0 },
    ])

    const gen = closeAgentPhase(phase)
    let next = await gen.next(undefined)
    while (!next.done) {
      if (next.value.type !== 'close_task_start')
        throw new Error(`the close emitted ${next.value.type}`)
      next = await gen.next(undefined)
    }

    expect(next.value).toEqual({ status: 'completed' })
    expect(seen).toEqual([[H1, H2], undefined])
    expect(closeClustersOf(phase.intermediates)).toEqual([[H1, H2]])
  })
})
