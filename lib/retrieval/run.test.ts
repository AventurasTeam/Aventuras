import { describe, expect, it, vi } from 'vitest'

import { EmbedderCallError, EmbedderInitError } from '@/lib/embedder'

import { KNN_K } from './constants'
import {
  runRetrieval,
  type RetrievalDeps,
  type RetrievalOutcome,
  type RetrievalParams,
  type RetrievalSuccess,
} from './run'
import { isHappeningCandidate, type QueryAll } from './types'

const DIM = 2

const unitBlob = (x: number, y: number): Uint8Array => {
  const n = Math.hypot(x, y)
  return new Uint8Array(Float32Array.from([x / n, y / n]).buffer)
}

type Row = unknown[]

// vec0 returns id, distance AND the embedding on the match row, so a KNN fixture
// row is three columns wide.
const hit = (id: string, distance = 0, blob = unitBlob(1, 0)): Row => [id, distance, blob]

const entityRow = (
  id: string,
  name: string,
  o: {
    kind?: string
    status?: string
    mode?: string
    description?: string | null
    stale?: 0 | 1
  } = {},
): Row => [
  id,
  o.kind ?? 'character',
  o.status ?? 'active',
  o.mode ?? 'auto',
  name,
  // Not `??`: these columns are nullable, and a null the caller asked for must
  // reach the row rather than fall back to the default string.
  o.description === undefined ? `About ${name}.` : o.description,
  o.stale ?? 0,
]

const loreRow = (
  id: string,
  title: string,
  o: {
    body?: string | null
    mode?: string
    priority?: number
    keywords?: string[]
    /** Bypasses JSON encoding, for the hand-edited-blob cases. */
    rawKeywords?: string
    stale?: 0 | 1
  } = {},
): Row => [
  id,
  title,
  o.body === undefined ? `Body of ${title}.` : o.body,
  o.mode ?? 'auto',
  o.priority ?? 0,
  o.rawKeywords ?? JSON.stringify(o.keywords ?? []),
  o.stale ?? 0,
]

const happeningRow = (
  id: string,
  title: string,
  o: { description?: string; common?: 0 | 1; occurredAt?: string | null; stale?: 0 | 1 } = {},
): Row => [
  id,
  title,
  o.description ?? `Description of ${title}.`,
  o.common ?? 0,
  o.occurredAt ?? null,
  o.stale ?? 0,
]

const threadRow = (
  id: string,
  title: string,
  o: { status?: string; mode?: string; description?: string | null; stale?: 0 | 1 } = {},
): Row => [
  id,
  o.status ?? 'pending',
  o.mode ?? 'auto',
  title,
  o.description === undefined ? `Description of ${title}.` : o.description,
  o.stale ?? 0,
]

const chapterRow = (
  id: string,
  title: string,
  o: { summary?: string; theme?: string; keywords?: string[]; stale?: 0 | 1 } = {},
): Row => [
  id,
  title,
  o.summary ?? `Summary of ${title}.`,
  o.theme ?? 'betrayal',
  JSON.stringify(o.keywords ?? []),
  o.stale ?? 0,
]

const awarenessRow = (
  id: string,
  happeningId: string,
  o: {
    characterId?: string
    learnedAt?: string | null
    pin?: number | null
    source?: string
    retrievalCount?: number
  } = {},
): Row => [
  id,
  happeningId,
  o.characterId ?? 'char_a',
  o.learnedAt ?? null,
  o.pin ?? null,
  o.source ?? 'saw it happen',
  o.retrievalCount ?? 0,
]

type Fixture = {
  entities?: Row[]
  lore?: Row[]
  happenings?: Row[]
  threads?: Row[]
  chapters?: Row[]
  awareness?: Row[]
  chapterRanges?: Row[]
  knn?: Row[]
  /** Answers the by-id vector fetch for pool-admitted rows the KNN never returned. */
  vectorsById?: Row[]
  /** Branch-wide stale-happening total; the pass counts rather than loading them. */
  happeningsStale?: number
  /** Omit for the normal case: every dim family exists. `[]` is a cold start. */
  vecTables?: Row[]
}

/**
 * Answers by SQL shape. These fixtures pin ranking logic, not the column
 * contract — source-rows.test.ts runs the same statements against the real
 * schema. Unhandled SQL throws rather than returning [], so a fixture gap fails
 * loudly.
 */
function makeQueryAll(rows: Fixture): QueryAll & { mock: { calls: unknown[][] } } {
  return vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes('sqlite_master')) return rows.vecTables ?? params.map((name) => [name])
    if (sql.includes('MATCH')) return rows.knn ?? []
    // Must precede the source-table arms: `FROM happenings_vec_2` contains the
    // literal `FROM happenings`, so a vector fetch would otherwise be answered
    // with source rows.
    if (sql.includes('_vec_')) return rows.vectorsById ?? []
    // Before the source-table arms: the tripwire counts branch-wide rather than
    // reading the pool subset, so it must not be answered with rows.
    if (sql.includes('COUNT(*)')) return [[rows.happeningsStale ?? 0]]
    if (sql.includes('JOIN story_entries')) return rows.chapterRanges ?? []
    if (sql.includes('happening_awareness')) return rows.awareness ?? []
    if (sql.includes('FROM chapters')) return rows.chapters ?? []
    if (sql.includes('FROM happenings')) return rows.happenings ?? []
    if (sql.includes('FROM threads')) return rows.threads ?? []
    if (sql.includes('FROM lore')) return rows.lore ?? []
    if (sql.includes('FROM entities')) return rows.entities ?? []
    throw new Error(`fixture has no arm for SQL: ${sql}`)
  })
}

const embedder = () =>
  vi.fn(async (texts: string[]) => ({
    vectors: texts.map(() => Float32Array.from([1, 0])),
    dim: DIM,
  }))

const deps = (over: Partial<RetrievalDeps> = {}): RetrievalDeps => ({
  queryAll: makeQueryAll({}),
  embedTexts: embedder(),
  embedRows: vi.fn(async () => []),
  loadStaleRows: vi.fn(async () => []),
  runInTransaction: vi.fn(async () => undefined),
  ...over,
})

const BASE: RetrievalParams = {
  branchId: 'br_1',
  modelId: 'm',
  dim: DIM,
  budgets: { entities: 1200, lore: 1800, happenings: 1500, threads: 400, chapters: 600 },
  query: {
    userAction: 'I ask about the amulet.',
    eraName: null,
    piggybackSummary: null,
    lastNarrativeContent: 'Kara Vex drew the blade.',
  },
  sceneCharacterIds: ['char_a'],
  sceneEntityIds: ['char_a'],
  currentLocationId: null,
  recentProse: '',
}

const params = (
  over: Partial<Omit<RetrievalParams, 'query'>> & {
    query?: Partial<RetrievalParams['query']>
  } = {},
): RetrievalParams => ({ ...BASE, ...over, query: { ...BASE.query, ...over.query } })

function expectOk(out: RetrievalOutcome): RetrievalSuccess {
  if (!out.ok) throw new Error(`expected a successful pass, got ${out.failure.reason}`)
  return out
}

function expectFailure(out: RetrievalOutcome): Extract<RetrievalOutcome, { ok: false }>['failure'] {
  if (out.ok) throw new Error('expected a blocking outcome, got a successful pass')
  return out.failure
}

const tracedIds = (bundle: { traces: readonly { id: string }[] }): string[] =>
  bundle.traces.map((t) => t.id)

type Mocked = { mock: { calls: unknown[][] } }

/** The (sql, params) of every KNN pass the run issued, in call order. */
const knnCalls = (queryAll: Mocked): { sql: string; params: unknown[] }[] =>
  queryAll.mock.calls
    .filter(([sql]) => String(sql).includes('MATCH'))
    .map(([sql, params]) => ({ sql: String(sql), params: params as unknown[] }))

/**
 * Wraps a fixture to record peak in-flight depth. The assertion is on overlap,
 * never on elapsed time, so it cannot flake on a loaded runner. The macrotask
 * hop is load-bearing: without it every stub settles before the next await
 * runs, and nothing overlaps regardless of the code under test.
 */
function instrumented(inner: QueryAll): QueryAll & { peak: { all: number; knn: number } } {
  const peak = { all: 0, knn: 0 }
  let inFlight = 0
  let knnInFlight = 0
  const wrapped = (async (sql: string, params: unknown[]) => {
    const isKnn = sql.includes('MATCH')
    inFlight += 1
    if (isKnn) knnInFlight += 1
    peak.all = Math.max(peak.all, inFlight)
    peak.knn = Math.max(peak.knn, knnInFlight)
    await new Promise((resolve) => setTimeout(resolve, 0))
    try {
      return await inner(sql, params)
    } finally {
      inFlight -= 1
      if (isKnn) knnInFlight -= 1
    }
  }) as QueryAll & { peak: { all: number; knn: number } }
  wrapped.peak = peak
  return wrapped
}

describe('runRetrieval — round-trip concurrency', () => {
  const fixture = () =>
    makeQueryAll({ entities: [entityRow('char_b', 'Mira')], knn: [hit('char_b')] })

  it('issues the independent source, awareness and range reads together', async () => {
    const queryAll = instrumented(fixture())

    expectOk(await runRetrieval(deps({ queryAll }), params()))

    // Five source-row reads plus awareness, chapter ranges and the vec-table
    // probe. Sequential awaits would hold this at 1.
    expect(queryAll.peak.all).toBeGreaterThanOrEqual(8)
  })

  it('issues the KNN passes together across kinds and query vectors', async () => {
    const queryAll = instrumented(fixture())

    expectOk(await runRetrieval(deps({ queryAll }), params()))

    // Three query vectors across five types; every vector is in hand before the
    // first round trip and the passes share no state.
    expect(queryAll.peak.knn).toBeGreaterThan(1)
  })
})

describe('runRetrieval — sync ordering', () => {
  // Replaces a runtime guard against a branchIds/branchId mismatch: RetrievalDeps
  // no longer carries branchIds, so the sync scope cannot disagree with the
  // branch being retrieved.
  it('syncs exactly the branch it retrieves', async () => {
    const loadStaleRows = vi.fn(async () => [])
    expectOk(await runRetrieval(deps({ loadStaleRows }), params({ branchId: 'br_9' })))

    expect(loadStaleRows).toHaveBeenCalledWith(['br_9'])
  })

  it('returns a blocking outcome when the sync stage fails, before any KNN', async () => {
    const queryAll = makeQueryAll({ entities: [entityRow('char_b', 'Mira')], knn: [hit('char_b')] })
    const out = await runRetrieval(
      deps({
        queryAll,
        loadStaleRows: async () => [
          { kind: 'lore', id: 'l1', branchId: 'br_1', fields: ['t', 'b'] },
        ],
        embedRows: async () => {
          throw new EmbedderInitError('embedder down')
        },
      }),
      params(),
    )

    const failure = expectFailure(out)
    expect(failure.reason).toBe('init')
    expect(failure.detail).toBe('embedder down')
    // The sync knew how many rows it was trying to embed, unlike a query-embed failure.
    expect(failure.staleCount).toBe(1)
    expect(knnCalls(queryAll)).toEqual([])
  })

  it('reads the source rows AFTER the sync commits, not before', async () => {
    // embedding_stale is the last column of every source-row projection.
    const clearStale = (row: Row): void => {
      row[row.length - 1] = 0
    }
    const run = async (sync: (row: Row) => void) => {
      const dirty = entityRow('en_dirty', 'Mira', { stale: 1 })
      return expectOk(
        await runRetrieval(
          deps({
            queryAll: makeQueryAll({ entities: [dirty], knn: [hit('en_dirty')] }),
            loadStaleRows: async () => [
              { kind: 'entity', id: 'en_dirty', branchId: 'br_1', fields: ['Mira', null] },
            ],
            runInTransaction: async () => sync(dirty),
          }),
          params({ sceneEntityIds: [], sceneCharacterIds: [] }),
        ),
      )
    }

    // Reading first would snapshot embedding_stale = 1 and fresh() would drop
    // the row from every pool, even though the sync just repaired it.
    expect(tracedIds((await run(clearStale)).bundles.entities)).toEqual(['en_dirty'])
    // Positive control: the same row stays out when the sync does NOT clear it.
    expect(tracedIds((await run(() => undefined)).bundles.entities)).toEqual([])
  })

  it('commits the sync transaction before the first KNN when rows are dirty', async () => {
    const order: string[] = []
    const inner = makeQueryAll({ entities: [entityRow('char_b', 'Mira')], knn: [hit('char_b')] })
    const out = await runRetrieval(
      deps({
        queryAll: async (sql, p) => {
          if (sql.includes('MATCH')) order.push('knn')
          return inner(sql, p)
        },
        loadStaleRows: async () => [
          { kind: 'lore', id: 'l1', branchId: 'br_1', fields: ['t', 'b'] },
        ],
        runInTransaction: async () => {
          order.push('sync')
        },
      }),
      params(),
    )

    expectOk(out)
    expect(order[0]).toBe('sync')
    expect(order).toContain('knn')
  })

  it('refreshes stale-row status after a dirty sync commits and before KNN', async () => {
    const order: string[] = []
    const inner = makeQueryAll({ entities: [entityRow('char_b', 'Mira')], knn: [hit('char_b')] })
    const onRowsSynced = vi.fn(async () => {
      order.push('status')
    })

    const out = await runRetrieval(
      deps({
        queryAll: async (sql, p) => {
          if (sql.includes('MATCH')) order.push('knn')
          return inner(sql, p)
        },
        loadStaleRows: async () => [
          { kind: 'lore', id: 'l1', branchId: 'br_1', fields: ['t', 'b'] },
        ],
        runInTransaction: async () => {
          order.push('sync')
        },
        onRowsSynced,
      }),
      params(),
    )

    expectOk(out)
    expect(onRowsSynced).toHaveBeenCalledTimes(1)
    expect(order.slice(0, 3)).toEqual(['sync', 'status', 'knn'])
  })
})

describe('runRetrieval — query embed failure', () => {
  // On an ordinary turn nothing is dirty, so runSyncStage returns before it ever
  // reaches the embedder — a dead provider is invisible to it and only the query
  // embed can report it.
  const withQueryEmbed = async (embedTexts: RetrievalDeps['embedTexts']) => {
    const queryAll = makeQueryAll({ entities: [entityRow('char_b', 'Mira')], knn: [hit('char_b')] })
    const out = await runRetrieval(deps({ queryAll, embedTexts }), params())
    return { failure: expectFailure(out), queryAll }
  }

  it('reports a typed init failure when the embedder session never comes up', async () => {
    const { failure, queryAll } = await withQueryEmbed(async () => {
      throw new EmbedderInitError('no local model')
    })
    expect(failure).toEqual({ reason: 'init', detail: 'no local model', staleCount: null })
    expect(knnCalls(queryAll)).toEqual([])
  })

  it('reports a typed call failure when the embed request itself fails', async () => {
    const { failure } = await withQueryEmbed(async () => {
      throw new EmbedderCallError('502 from provider')
    })
    expect(failure).toEqual({ reason: 'call', detail: '502 from provider', staleCount: null })
  })

  it("takes 'init' for an untyped throw, which has no standing to claim the session is up", async () => {
    const { failure } = await withQueryEmbed(async () => {
      throw new Error('socket hang up')
    })
    expect(failure).toEqual({ reason: 'init', detail: 'socket hang up', staleCount: null })
  })

  it('reports a non-Error throw rather than losing it', async () => {
    const { failure } = await withQueryEmbed(async () => {
      throw 'nope'
    })
    expect(failure).toEqual({ reason: 'init', detail: 'nope', staleCount: null })
  })

  it('fails when the provider serves a dim other than the one the KNN reads', async () => {
    const { failure, queryAll } = await withQueryEmbed(async (texts) => ({
      vectors: texts.map(() => Float32Array.from([1, 0])),
      dim: DIM + 1,
    }))
    expect(failure.reason).toBe('call')
    expect(failure.staleCount).toBeNull()
    // Both dims named: the sqlite-vec error this pre-empts is opaque.
    expect(failure.detail).toContain(String(DIM + 1))
    expect(failure.detail).toContain(`dim-${DIM}`)
    expect(knnCalls(queryAll)).toEqual([])
    // Positive control: the same pass succeeds at the matching dim.
    expect(expectOk(await runRetrieval(deps(), params())).ok).toBe(true)
  })

  // A stored vector that is not unit-norm means this branch's vectors do not
  // match the model the pass reads, which is an embedder problem: escaping as a
  // raw throw would bucket it as an orchestrator error, whose only affordance is
  // a Retry that fails identically instead of Switch embedder.
  it('reports a corrupt stored vector on the embedder surface, not as a throw', async () => {
    const notUnit = new Uint8Array(Float32Array.from([2, 2]).buffer)
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          entities: [entityRow('char_b', 'Mira')],
          knn: [hit('char_b', 0, notUnit)],
        }),
      }),
      params(),
    )

    const failure = expectFailure(out)
    expect(failure.reason).toBe('init')
    expect(failure.detail).toMatch(/unit-norm/)
  })

  // Companion to the sync stage's hand-off test. The query embed is the second
  // place a stalled provider can park the turn, and the bounded signal the phase
  // builds is worthless if the pass drops it on the floor.
  it('hands the abort signal to the query embed', async () => {
    const abortSignal = new AbortController().signal
    const embedTexts = embedder()

    expect(expectOk(await runRetrieval(deps({ abortSignal, embedTexts }), params())).ok).toBe(true)
    expect(embedTexts).toHaveBeenCalledWith(expect.anything(), abortSignal)
  })

  // The counterpart to the test above. A locked DB, a dead IPC bridge or a bug
  // in the ranker says nothing about the stored vectors, so it must NOT take the
  // embedder surface — whose fix action re-indexes the whole story.
  it('lets a SQL fault escape instead of reporting it on the embedder surface', async () => {
    const locked = new Error('SQLITE_BUSY: database is locked')
    await expect(
      runRetrieval(
        deps({
          queryAll: vi.fn(async () => {
            throw locked
          }),
        }),
        params(),
      ),
    ).rejects.toThrow(locked)
  })
})

describe('runRetrieval — KNN passes', () => {
  /** The vec family each pass targeted, which encodes both the kind and the dim. */
  const knnTables = (queryAll: Mocked): (string | undefined)[] =>
    knnCalls(queryAll).map((c) => /FROM\s+(\S+)/.exec(c.sql)?.[1])

  // Counted per family rather than compared as an ordered list: the kinds now
  // issue concurrently, and happenings deliberately trail the chapter ranking,
  // so call order is an implementation detail. The one ordering that IS a
  // contract has its own test below.
  const knnCountsByFamily = (queryAll: Mocked): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const table of knnTables(queryAll))
      if (table !== undefined) out[table] = (out[table] ?? 0) + 1
    return out
  }

  const perKind = (times: number): Record<string, number> =>
    Object.fromEntries(
      ['entities_vec', 'lore_vec', 'happenings_vec', 'threads_vec', 'chapter_summaries_vec'].map(
        (family) => [`${family}_${DIM}`, times],
      ),
    )

  // Every query is present here: Q1 from userAction, Q2 from the seated scene
  // entity, Q3 from lastNarrativeContent.
  const allThree = () => makeQueryAll({ entities: [entityRow('char_a', 'Kara Vex')] })

  it("issues one pass per present query per type, against that type's vec family", async () => {
    const queryAll = allThree()
    const out = expectOk(await runRetrieval(deps({ queryAll }), params()))

    expect(out.queries.presence).toEqual([true, true, true])
    expect(knnCountsByFamily(queryAll)).toEqual(perKind(3))
  })

  // A story that needs no lead entity embeds nothing at creation, so the dim
  // family does not exist on turn 1 and vec0 answers a KNN with "no such table".
  it('skips the KNN entirely when the dim family does not exist yet', async () => {
    const queryAll = makeQueryAll({ entities: [entityRow('char_a', 'Kara Vex')], vecTables: [] })
    const out = expectOk(await runRetrieval(deps({ queryAll }), params()))

    expect(knnTables(queryAll)).toEqual([])
    expect(out.bundles.entities.selected).toEqual([])
  })

  it('collapses to one pass per type when only Q1 has text', async () => {
    const queryAll = allThree()
    const out = expectOk(
      await runRetrieval(
        deps({ queryAll }),
        params({
          sceneEntityIds: [],
          sceneCharacterIds: [],
          query: { lastNarrativeContent: '' },
        }),
      ),
    )

    expect(out.queries.presence).toEqual([true, false, false])
    expect(knnCountsByFamily(queryAll)).toEqual(perKind(1))
  })

  it('binds the configured k, branch and model on every pass', async () => {
    const queryAll = allThree()
    expectOk(await runRetrieval(deps({ queryAll }), params({ modelId: 'bge-m3' })))

    const calls = knnCalls(queryAll)
    expect(calls).toHaveLength(15)
    for (const { sql, params: bound } of calls) {
      expect(sql).toContain('k = ?')
      // knnQuery binds [vector, k, branchId, modelId].
      expect(bound[0]).toBeInstanceOf(Uint8Array)
      expect(bound[1]).toBe(KNN_K)
      expect(bound[2]).toBe('br_1')
      expect(bound[3]).toBe('bge-m3')
    }
  })
})

/**
 * retrieval.md → Chapter-match boost on happenings. The boost exists because
 * pure-similarity happening retrieval comes out scattered, so gating pool
 * membership on that same similarity puts the boost out of reach of exactly the
 * rows it is meant to rescue: a happening outside the KNN cut for all three
 * query vectors is never scored at all.
 */
describe('runRetrieval — chapter-range pool admission', () => {
  const inRange = () =>
    makeQueryAll({
      // The KNN never returns hap_far; only its chapter range does.
      knn: [hit('ch1')],
      chapters: [chapterRow('ch1', 'The Tin Gate')],
      chapterRanges: [['ch1', 'entry_7']],
      happenings: [happeningRow('hap_far', 'Kara traded the amulet', { occurredAt: 'entry_7' })],
      awareness: [awarenessRow('aw_1', 'hap_far')],
      vectorsById: [['hap_far', unitBlob(1, 0)]],
    })

  it('admits a happening inside a seated chapter range that no KNN pass returned', async () => {
    const queryAll = inRange()

    const out = expectOk(await runRetrieval(deps({ queryAll }), params()))

    expect(tracedIds(out.bundles.happenings)).toContain('hap_far')
    const trace = out.bundles.happenings.traces.find((t) => t.id === 'hap_far')
    expect(trace?.chapterBoostApplied).toBe(true)
  })

  it('ranks chapters before the happenings KNN, since seating decides admission', async () => {
    const queryAll = inRange()

    expectOk(await runRetrieval(deps({ queryAll }), params()))

    const families = knnCalls(queryAll).map((c) => /FROM\s+(\S+)/.exec(c.sql)?.[1])
    const lastChapter = families.lastIndexOf(`chapter_summaries_vec_${DIM}`)
    const firstHappening = families.indexOf(`happenings_vec_${DIM}`)
    expect(lastChapter).toBeGreaterThanOrEqual(0)
    expect(firstHappening).toBeGreaterThan(lastChapter)
  })

  // Admission widens the pool; it does not bypass the pool's own predicates.
  it('still applies the POV-awareness filter to an admitted happening', async () => {
    const queryAll = makeQueryAll({
      knn: [hit('ch1')],
      chapters: [chapterRow('ch1', 'The Tin Gate')],
      chapterRanges: [['ch1', 'entry_7']],
      happenings: [happeningRow('hap_far', 'Unwitnessed', { occurredAt: 'entry_7' })],
      // No awareness row and not common knowledge: outside the scene POV union.
      awareness: [],
      vectorsById: [['hap_far', unitBlob(1, 0)]],
    })

    const out = expectOk(await runRetrieval(deps({ queryAll }), params()))

    expect(tracedIds(out.bundles.happenings)).not.toContain('hap_far')
  })

  // A row with no vector in this family was never embedded under this model;
  // defaulting it to zeros would score it as a real candidate.
  it('drops an admitted id whose vector the family does not hold', async () => {
    const queryAll = makeQueryAll({
      knn: [hit('ch1')],
      chapters: [chapterRow('ch1', 'The Tin Gate')],
      chapterRanges: [['ch1', 'entry_7']],
      happenings: [happeningRow('hap_far', 'Never embedded', { occurredAt: 'entry_7' })],
      awareness: [awarenessRow('aw_1', 'hap_far')],
      vectorsById: [],
    })

    const out = expectOk(await runRetrieval(deps({ queryAll }), params()))

    expect(tracedIds(out.bundles.happenings)).not.toContain('hap_far')
  })

  it('fetches vectors only for admitted ids the KNN did not already return', async () => {
    const queryAll = makeQueryAll({
      knn: [hit('ch1')],
      chapters: [chapterRow('ch1', 'The Tin Gate')],
      chapterRanges: [['ch1', 'entry_7']],
      happenings: [happeningRow('hap_far', 'Kara traded', { occurredAt: 'entry_7' })],
      awareness: [awarenessRow('aw_1', 'hap_far')],
      vectorsById: [['hap_far', unitBlob(1, 0)]],
    })

    expectOk(await runRetrieval(deps({ queryAll }), params()))

    const fetches = queryAll.mock.calls.filter(
      ([sql]) => String(sql).includes('_vec_') && !String(sql).includes('MATCH'),
    )
    expect(fetches).toHaveLength(1)
    // knnQuery already carried every hit's embedding on its match row.
    expect(fetches[0][1]).toEqual(['br_1', 'm', 'hap_far'])
  })
})

describe('runRetrieval — query stack', () => {
  it('renders Q2 from the structural floor', async () => {
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          entities: [
            entityRow('char_a', 'Kara Vex'),
            entityRow('loc_1', 'The Hollow', { kind: 'location' }),
          ],
          threads: [threadRow('th_1', 'The Amulet', { status: 'active' })],
        }),
      }),
      params({ currentLocationId: 'loc_1' }),
    )

    expect(expectOk(out).queries.q2.text).toBe('Kara Vex, The Hollow.\nActive threads: The Amulet.')
  })

  it('skips the embed call when every query is empty', async () => {
    const embedTexts = embedder()
    const out = await runRetrieval(
      deps({
        embedTexts,
        queryAll: makeQueryAll({
          lore: [loreRow('lore_1', 'Veilstone', { mode: 'always' })],
          knn: [hit('lore_1')],
        }),
      }),
      params({
        sceneEntityIds: [],
        sceneCharacterIds: [],
        query: { userAction: '', lastNarrativeContent: '' },
      }),
    )

    const ok = expectOk(out)
    expect(embedTexts).not.toHaveBeenCalled()
    // The floor never consults a vector, so it survives a fully absent query stack.
    expect(ok.floor.alwaysLore.map((l) => l.id)).toEqual(['lore_1'])
    expect(Object.values(ok.bundles).every((b) => b.selected.length === 0)).toBe(true)
  })

  it('scores against the surviving queries when the embedder returns fewer vectors', async () => {
    const out = await runRetrieval(
      deps({
        embedTexts: vi.fn(async () => ({
          vectors: [Float32Array.from([1, 0]), Float32Array.from([1, 0])],
          dim: DIM,
        })),
        queryAll: makeQueryAll({
          entities: [entityRow('char_a', 'Kara Vex'), entityRow('char_b', 'Mira')],
          knn: [hit('char_b')],
        }),
      }),
      params(),
    )

    const trace = expectOk(out).bundles.entities.traces.find((t) => t.id === 'char_b')
    expect(trace).toBeDefined()
    expect(trace?.simQ3).toBeNull()
    // Q3 produced no vector, so the blend renormalizes over Q1 + Q2 only.
    // Counting the absent slot as a zero similarity would give 0.7.
    expect(trace?.simBlend).toBe(1)
  })
})

describe('runRetrieval — pools', () => {
  it('excludes a floor-seated entity from the entity pool', async () => {
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          entities: [entityRow('char_a', 'Kara Vex'), entityRow('char_b', 'Mira')],
          knn: [hit('char_a'), hit('char_b')],
        }),
      }),
      params(),
    )

    const ok = expectOk(out)
    expect(ok.floor.sceneEntities.map((e) => e.id)).toContain('char_a')
    expect(tracedIds(ok.bundles.entities)).not.toContain('char_a')
    expect(tracedIds(ok.bundles.entities)).toContain('char_b')
  })

  it('drops a KNN hit the pool predicates exclude', async () => {
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          lore: [
            loreRow('lore_off', 'Silenced', { mode: 'disabled' }),
            loreRow('lore_on', 'Veilstone', { priority: 60 }),
          ],
          knn: [hit('lore_off'), hit('lore_on')],
        }),
      }),
      params(),
    )

    const ok = expectOk(out)
    expect(tracedIds(ok.bundles.lore)).not.toContain('lore_off')
    expect(tracedIds(ok.bundles.lore)).toContain('lore_on')
    expect(ok.bundles.lore.traces[0].pinSignal).toBe(0.6)
  })

  it('limits the pool to the ids the KNN union returned', async () => {
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          lore: [loreRow('lore_near', 'Veilstone'), loreRow('lore_far', 'Driftmark')],
          knn: [hit('lore_near')],
        }),
      }),
      params(),
    )

    const ok = expectOk(out)
    expect(tracedIds(ok.bundles.lore)).toEqual(['lore_near'])
  })

  it('seats active and always threads on the floor instead of the thread pool', async () => {
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          threads: [
            threadRow('th_active', 'The Siege', { status: 'active' }),
            threadRow('th_always', 'The Debt', { mode: 'always' }),
            threadRow('th_pending', 'The Amulet'),
          ],
          knn: [hit('th_active'), hit('th_always'), hit('th_pending')],
        }),
      }),
      params(),
    )

    const ok = expectOk(out)
    expect(ok.floor.activeThreads.map((t) => t.id)).toEqual(['th_active'])
    expect(ok.floor.alwaysThreads.map((t) => t.id)).toEqual(['th_always'])
    expect(tracedIds(ok.bundles.threads)).toEqual(['th_pending'])
  })

  it('counts stale rows per type', async () => {
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          entities: [entityRow('en_1', 'Kara Vex', { stale: 1 })],
          lore: [loreRow('lo_1', 'A', { stale: 1 }), loreRow('lo_2', 'B', { stale: 1 })],
          happeningsStale: 3,
          threads: [threadRow('th_1', 'A')],
          chapters: [
            chapterRow('ch_1', 'A', { stale: 1 }),
            chapterRow('ch_2', 'B', { stale: 1 }),
            chapterRow('ch_3', 'C', { stale: 1 }),
            chapterRow('ch_4', 'D', { stale: 1 }),
          ],
        }),
      }),
      params({ sceneEntityIds: [], sceneCharacterIds: [] }),
    )

    expect(expectOk(out).staleCounts).toEqual({
      entities: 1,
      lore: 2,
      happenings: 3,
      threads: 0,
      chapters: 4,
    })
  })

  it('excludes a stale row from every pool', async () => {
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          entities: [
            entityRow('en_stale', 'Drifted', { stale: 1 }),
            entityRow('en_fresh', 'Kara Vex'),
          ],
          lore: [loreRow('lo_stale', 'Drifted', { stale: 1 }), loreRow('lo_fresh', 'Veilstone')],
          happenings: [
            happeningRow('hp_stale', 'Drifted', { common: 1, stale: 1 }),
            happeningRow('hp_fresh', 'The bell rang', { common: 1 }),
          ],
          threads: [
            threadRow('th_stale', 'Drifted', { stale: 1 }),
            threadRow('th_fresh', 'The Amulet'),
          ],
          chapters: [
            chapterRow('ch_stale', 'Drifted', { stale: 1 }),
            chapterRow('ch_fresh', 'Chapter One'),
          ],
          knn: [
            hit('en_stale'),
            hit('en_fresh'),
            hit('lo_stale'),
            hit('lo_fresh'),
            hit('hp_stale'),
            hit('hp_fresh'),
            hit('th_stale'),
            hit('th_fresh'),
            hit('ch_stale'),
            hit('ch_fresh'),
          ],
        }),
      }),
      params({ sceneEntityIds: [], sceneCharacterIds: [] }),
    )

    const ok = expectOk(out)
    // flagEmbeddingStaleOps only sets the flag; the row keeps its old vector and
    // vec0 still returns it, so every pool has to drop it explicitly.
    expect(tracedIds(ok.bundles.entities)).toEqual(['en_fresh'])
    expect(tracedIds(ok.bundles.lore)).toEqual(['lo_fresh'])
    expect(tracedIds(ok.bundles.happenings)).toEqual(['hp_fresh'])
    expect(tracedIds(ok.bundles.threads)).toEqual(['th_fresh'])
    expect(tracedIds(ok.bundles.chapters)).toEqual(['ch_fresh'])
  })

  it('suppresses a staged entity whose name appears in recent prose', async () => {
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          entities: [
            entityRow('stg_a', 'Mira', { status: 'staged' }),
            entityRow('stg_b', 'Dalen', { status: 'staged' }),
          ],
          knn: [hit('stg_a'), hit('stg_b')],
        }),
      }),
      params({ sceneEntityIds: [], recentProse: 'Mira stepped out of the shadows.' }),
    )

    const ok = expectOk(out)
    expect(tracedIds(ok.bundles.entities)).not.toContain('stg_a')
    expect(tracedIds(ok.bundles.entities)).toContain('stg_b')
    expect(ok.bundles.entities.selected.map((c) => c.renderedText)).toEqual([
      'Dalen (available to introduce): About Dalen.',
    ])
  })

  it('frames an off-scene active entity and a staged entity per canon', async () => {
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          entities: [
            entityRow('act_off', 'Mira', { description: 'A ranger.' }),
            entityRow('stg', 'Dalen', { status: 'staged', description: 'A smith.' }),
          ],
          knn: [hit('act_off'), hit('stg')],
        }),
      }),
      params({ sceneEntityIds: [], sceneCharacterIds: [] }),
    )

    const ok = expectOk(out)
    expect(ok.bundles.entities.selected.map((c) => c.renderedText).sort()).toEqual([
      'Dalen (available to introduce): A smith.',
      'Mira (currently elsewhere): A ranger.',
    ])
  })

  // renderedText is the only string the ranker measures, so anything a block
  // would otherwise render beside a row has to live inside it — a chapter's
  // title is length the type budget never charged for once it sits on a
  // separate `##` line.
  it('carries the chapter title inside renderedText, ahead of summary and theme', async () => {
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          chapters: [chapterRow('ch_1', 'The Long Road', { summary: 'She left.', theme: 'exile' })],
          knn: [hit('ch_1')],
        }),
      }),
      params({ sceneEntityIds: [], sceneCharacterIds: [] }),
    )

    expect(expectOk(out).bundles.chapters.selected.map((c) => c.renderedText)).toEqual([
      'The Long Road\nShe left.\nexile',
    ])
  })

  // data-model.md → threads: "failed is distinct because lumping them together
  // loses useful information", and the whole thread pool is non-active, so a
  // lone title leaves a paid debt indistinguishable from an open one.
  it.each(['pending', 'resolved', 'failed'])(
    'carries a %s thread status inside renderedText',
    async (status) => {
      const out = await runRetrieval(
        deps({
          queryAll: makeQueryAll({
            threads: [threadRow('th_1', 'The debt', { status, description: 'Unpaid.' })],
            knn: [hit('th_1')],
          }),
        }),
        params({ sceneEntityIds: [], sceneCharacterIds: [] }),
      )

      expect(expectOk(out).bundles.threads.selected.map((c) => c.renderedText)).toEqual([
        `The debt (${status})\nUnpaid.`,
      ])
    },
  )

  // A null column must not leave its separator behind: "Mira: " reads to the
  // model as a truncated description rather than an absent one, and the ranker
  // charges the budget for the separator either way.
  it('drops the separator on a row whose nullable column is null', async () => {
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          entities: [entityRow('act_off', 'Mira', { description: null })],
          lore: [loreRow('lo_1', 'The Concord', { body: null })],
          threads: [threadRow('th_1', 'The debt', { description: null })],
          knn: [hit('act_off'), hit('lo_1'), hit('th_1')],
        }),
      }),
      params({ sceneEntityIds: [], sceneCharacterIds: [] }),
    )

    const ok = expectOk(out)
    expect(ok.bundles.entities.selected.map((c) => c.renderedText)).toEqual([
      'Mira (currently elsewhere)',
    ])
    expect(ok.bundles.lore.selected.map((c) => c.renderedText)).toEqual(['The Concord'])
    expect(ok.bundles.threads.selected.map((c) => c.renderedText)).toEqual(['The debt (pending)'])
  })

  // Non-happening kinds no longer carry the field at all, so the aliasing this
  // once guarded is unrepresentable there; happenings still build one array per
  // candidate, and a shared instance would make every bump target every row.
  it('gives every happening candidate its own awarenessIds array', async () => {
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          happenings: [happeningRow('hap_1', 'The bell rang'), happeningRow('hap_2', 'It rang on')],
          awareness: [awarenessRow('haw_1', 'hap_1'), awarenessRow('haw_2', 'hap_2')],
          knn: [hit('hap_1'), hit('hap_2')],
        }),
      }),
      params(),
    )

    const arrays = expectOk(out)
      .bundles.happenings.selected.filter(isHappeningCandidate)
      .map((c) => c.awarenessIds)
    expect(arrays).toHaveLength(2)
    expect(arrays[0]).not.toBe(arrays[1])
  })

  it('drops the awareness pin on a common-knowledge happening, and only there', async () => {
    const pinOf = async (common: 0 | 1) => {
      const out = await runRetrieval(
        deps({
          queryAll: makeQueryAll({
            happenings: [happeningRow('hap_1', 'The bell rang', { common })],
            awareness: [awarenessRow('haw_1', 'hap_1', { pin: 0.9 })],
            knn: [hit('hap_1')],
          }),
        }),
        params(),
      )
      return expectOk(out).bundles.happenings.selected.find((c) => c.id === 'hap_1')?.pinSignal
    }

    // Nothing in the schema stops a common-knowledge row from carrying awareness
    // rows too, and canon says it carries no decay_resistance signal.
    expect(await pinOf(1)).toBe(0)
    // Positive control: the same awareness row pins a non-common happening.
    expect(await pinOf(0)).toBe(0.9)
  })

  it('admits a common-knowledge happening that has no awareness row', async () => {
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          happenings: [happeningRow('hap_1', 'The bell rang', { common: 1 })],
          awareness: [],
          knn: [hit('hap_1', 0.2)],
        }),
      }),
      params(),
    )

    const ok = expectOk(out)
    const trace = ok.bundles.happenings.traces.find((t) => t.id === 'hap_1')
    expect(trace).toBeDefined()
    expect(trace?.pinSignal).toBe(0)
    expect(trace?.recencyFactor).toBe(1)
    expect(ok.bundles.happenings.selected.filter(isHappeningCandidate)[0].commonKnowledge).toBe(
      true,
    )
  })

  it('excludes a happening no in-scene awareness row came back for', async () => {
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          happenings: [
            happeningRow('hap_private', 'A secret', { occurredAt: 'e1' }),
            happeningRow('hap_open', 'The bell rang', { common: 1 }),
          ],
          // loadAwarenessForScene filters on character_id IN (sceneCharacterIds),
          // so an out-of-scene row simply never comes back.
          awareness: [],
          knn: [hit('hap_private'), hit('hap_open')],
        }),
      }),
      params(),
    )

    const ok = expectOk(out)
    expect(tracedIds(ok.bundles.happenings)).not.toContain('hap_private')
    expect(tracedIds(ok.bundles.happenings)).toContain('hap_open')
  })

  it('reports injectedAwarenessIds for every selected happening', async () => {
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          happenings: [happeningRow('hap_1', 'The blade', { occurredAt: 'e1' })],
          awareness: [awarenessRow('haw_1', 'hap_1', { pin: 0.5, source: 'Kara saw it' })],
          knn: [hit('hap_1')],
        }),
      }),
      params(),
    )

    const ok = expectOk(out)
    expect(ok.bundles.happenings.selected.map((c) => c.id)).toContain('hap_1')
    expect(ok.injectedAwareness).toEqual([{ id: 'haw_1', retrievalCount: 0 }])
    // decay_resistance rides in from the awareness row, not the happening.
    expect(ok.bundles.happenings.traces[0].pinSignal).toBe(0.5)
  })

  // Two in-scene characters aware of one event is the ordinary production shape,
  // and the only one where the per-happening bucket holds more than one row.
  it('folds every in-scene holder of one happening into its ids, pin and text', async () => {
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          happenings: [
            happeningRow('hap_1', 'The oath', {
              description: 'An oath was sworn.',
              occurredAt: 'e1',
            }),
          ],
          awareness: [
            awarenessRow('haw_a', 'hap_1', {
              characterId: 'char_a',
              pin: 0.2,
              source: 'Kara saw it',
            }),
            awarenessRow('haw_b', 'hap_1', {
              characterId: 'char_b',
              pin: 0.7,
              source: 'Mira heard it',
            }),
          ],
          knn: [hit('hap_1')],
        }),
      }),
      params({ sceneCharacterIds: ['char_a', 'char_b'], sceneEntityIds: [] }),
    )

    const ok = expectOk(out)
    expect(ok.injectedAwareness).toEqual([
      { id: 'haw_a', retrievalCount: 0 },
      { id: 'haw_b', retrievalCount: 0 },
    ])
    const selected = ok.bundles.happenings.selected.find((c) => c.id === 'hap_1')
    // Max over the holders, not min or first-wins: the most pinned holder is
    // what keeps the row alive against decay.
    expect(selected?.pinSignal).toBe(0.7)
    // Every holder's source reaches the prompt, not just the first bucket entry.
    expect(selected?.renderedText).toBe('The oath\nAn oath was sworn.\nKara saw it\nMira heard it')
  })

  it('boosts a happening inside the entry range of a selected chapter', async () => {
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          chapters: [chapterRow('chap_1', 'Chapter One')],
          chapterRanges: [['chap_1', 'e1']],
          happenings: [
            happeningRow('hap_in', 'The blade', { common: 1, occurredAt: 'e1' }),
            happeningRow('hap_out', 'The bell', { common: 1, occurredAt: 'e9' }),
          ],
          knn: [hit('chap_1'), hit('hap_in'), hit('hap_out')],
        }),
      }),
      params(),
    )

    const ok = expectOk(out)
    expect(ok.bundles.chapters.selected.map((c) => c.id)).toContain('chap_1')
    expect(ok.bundles.chapters.traces[0].displayName).toBe('Chapter One')
    const boosted = (id: string) =>
      ok.bundles.happenings.traces.find((t) => t.id === id)?.chapterBoostApplied
    expect(boosted('hap_in')).toBe(true)
    expect(boosted('hap_out')).toBe(false)
  })
})

// The index is derived from the source rows the pass already loaded, so these
// pin that derivation through its two consumers: the happening keyword surface
// and Q3 sentence selection.
describe('runRetrieval — timings', () => {
  const STAGES = ['syncMs', 'embedMs', 'knnMs', 'rankMs'] as const

  it('reports a finite non-negative duration for the pass and each stage', async () => {
    const ok = expectOk(
      await runRetrieval(
        deps({
          queryAll: makeQueryAll({
            entities: [entityRow('char_b', 'Mira')],
            knn: [hit('char_b')],
          }),
        }),
        params(),
      ),
    )

    for (const key of ['totalMs', ...STAGES] as const) {
      expect(Number.isFinite(ok.timings[key]), key).toBe(true)
      expect(ok.timings[key], key).toBeGreaterThanOrEqual(0)
    }
  })

  // Each injectable stage burns a distinct span, so a clock wrapped around the
  // wrong one reads under its own floor. A busy-wait rather than a timer:
  // setTimeout is scheduled off a coarser clock than performance.now() and can
  // return marginally short of its delay, which made a timer-based floor flake.
  it('attributes each stage its own span, all of them inside the total', async () => {
    const spin = (ms: number) => {
      const until = performance.now() + ms
      while (performance.now() < until) {
        /* hold the same clock the timings are measured with */
      }
    }
    const SYNC_MS = 20
    const EMBED_MS = 10
    const KNN_MS = 1

    const rows = { entities: [entityRow('char_b', 'Mira')], knn: [hit('char_b')] }
    const inner = makeQueryAll(rows)
    const ok = expectOk(
      await runRetrieval(
        deps({
          queryAll: async (sql, bound) => {
            if (sql.includes('MATCH')) spin(KNN_MS)
            return inner(sql, bound)
          },
          loadStaleRows: async () => [
            { kind: 'entity', id: 'char_b', branchId: 'br_1', fields: ['Mira', null] },
          ],
          embedRows: async () => {
            spin(SYNC_MS)
            return []
          },
          embedTexts: async (texts) => {
            spin(EMBED_MS)
            return { vectors: texts.map(() => Float32Array.from([1, 0])), dim: DIM }
          },
        }),
        params(),
      ),
    )

    expect(ok.timings.syncMs).toBeGreaterThanOrEqual(SYNC_MS)
    expect(ok.timings.embedMs).toBeGreaterThanOrEqual(EMBED_MS)
    // One KNN pass per present query per type; the floor is one pass' worth.
    expect(ok.timings.knnMs).toBeGreaterThanOrEqual(KNN_MS)
    const stages = STAGES.reduce((sum, key) => sum + ok.timings[key], 0)
    expect(stages).toBeLessThanOrEqual(ok.timings.totalMs)
    expect(ok.timings.totalMs).toBeGreaterThanOrEqual(SYNC_MS + EMBED_MS + KNN_MS)
  })
})

describe('runRetrieval — selected location ids', () => {
  it('reports which selected entity rows are places, and only those', async () => {
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          entities: [
            entityRow('loc_market', 'The Market', { kind: 'location' }),
            entityRow('char_b', 'Mira'),
          ],
          knn: [hit('loc_market'), hit('char_b')],
        }),
      }),
      params(),
    )

    const ok = expectOk(out)
    // Positive control: both rows were selected, so the exclusion below is
    // about EntityKind rather than about one row missing the bundle.
    expect(ok.bundles.entities.selected.map((c) => c.id).sort()).toEqual(['char_b', 'loc_market'])
    expect(ok.selectedLocationIds).toEqual(['loc_market'])
  })

  it('omits a place the ranker never seated', async () => {
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          entities: [entityRow('loc_market', 'The Market', { kind: 'location' })],
          knn: [hit('loc_market')],
        }),
      }),
      // A budget under the entity type overhead seats nothing at all.
      params({ budgets: { ...BASE.budgets, entities: 1 } }),
    )

    const ok = expectOk(out)
    expect(ok.bundles.entities.selected).toEqual([])
    expect(ok.selectedLocationIds).toEqual([])
    // Positive control: the same row is reported once its budget admits it.
    expect(
      expectOk(
        await runRetrieval(
          deps({
            queryAll: makeQueryAll({
              entities: [entityRow('loc_market', 'The Market', { kind: 'location' })],
              knn: [hit('loc_market')],
            }),
          }),
          params(),
        ),
      ).selectedLocationIds,
    ).toEqual(['loc_market'])
  })
})

describe('runRetrieval — name/keyword index', () => {
  it('boosts a happening whose awareness source names a branch entity', async () => {
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          entities: [entityRow('char_a', 'Kara Vex')],
          happenings: [
            happeningRow('hap_named', 'The oath'),
            happeningRow('hap_plain', 'The bell'),
          ],
          awareness: [
            awarenessRow('haw_1', 'hap_named', { source: 'Kara Vex swore it' }),
            awarenessRow('haw_2', 'hap_plain', { source: 'someone rang it' }),
          ],
          knn: [hit('hap_named'), hit('hap_plain')],
        }),
      }),
      params(),
    )

    const ok = expectOk(out)
    const boost = (id: string) =>
      ok.bundles.happenings.traces.find((t) => t.id === id)?.kwBoostValue
    expect(boost('hap_named')).toBeGreaterThan(0)
    // Negative control: an awareness source naming nothing in the index.
    expect(boost('hap_plain')).toBe(0)
  })

  it('scores Q3 sentence selection with the branch lore keywords', async () => {
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          lore: [loreRow('lore_1', 'The Veil', { keywords: ['veilstone'] })],
        }),
      }),
      params({
        sceneEntityIds: [],
        sceneCharacterIds: [],
        query: {
          lastNarrativeContent:
            'Rain fell over the long grey afternoon and nothing happened. The veilstone hummed.',
        },
      }),
    )

    const scores = expectOk(out).queries.q3.sentenceScores ?? []
    expect(scores).toHaveLength(2)
    expect(scores[1]).toBeGreaterThan(scores[0])
  })
})

describe('runRetrieval — keyword boost', () => {
  it('matches the candidate keyword surface against the query texts, Q2 included', async () => {
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          lore: [
            loreRow('lore_hit', 'The Veil', { keywords: ['Veilstone'] }),
            loreRow('lore_miss', 'The Drift', { keywords: ['Driftmark'] }),
          ],
          knn: [hit('lore_hit'), hit('lore_miss')],
        }),
      }),
      // The era name reaches the query stack through Q2 only.
      params({ query: { eraName: 'Veilstone' } }),
    )

    const ok = expectOk(out)
    const boost = (id: string) => ok.bundles.lore.traces.find((t) => t.id === id)?.kwBoostValue
    expect(boost('lore_hit')).toBeGreaterThan(0)
    expect(boost('lore_miss')).toBe(0)
  })

  it('keeps ranking a lore row whose keywords blob is unusable', async () => {
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          lore: [
            loreRow('lore_broken', 'The Veil', { rawKeywords: '{' }),
            loreRow('lore_scalar', 'The Drift', { rawKeywords: '"amulet"' }),
            loreRow('lore_ok', 'The Relic', { keywords: ['amulet'] }),
          ],
          knn: [hit('lore_broken'), hit('lore_scalar'), hit('lore_ok')],
        }),
      }),
      params(),
    )

    const ok = expectOk(out)
    const boost = (id: string) => ok.bundles.lore.traces.find((t) => t.id === id)?.kwBoostValue
    expect(boost('lore_ok')).toBeGreaterThan(0)
    expect(boost('lore_broken')).toBe(0)
    // A JSON scalar parses fine but is not a term list.
    expect(boost('lore_scalar')).toBe(0)
  })

  it('matches a decomposed keyword against composed query prose', async () => {
    // matchTerms NFC-normalizes its haystack but not its terms, so a keyword
    // stored decomposed never matches composed prose unless the term is
    // normalized the same way.
    const nfd = `Zoe${String.fromCodePoint(0x308)}`
    const nfc = nfd.normalize('NFC')
    const out = await runRetrieval(
      deps({
        queryAll: makeQueryAll({
          lore: [
            loreRow('lore_nfd', 'The Sister', { keywords: [nfd] }),
            loreRow('lore_ascii', 'The Relic', { keywords: ['amulet'] }),
          ],
          knn: [hit('lore_nfd'), hit('lore_ascii')],
        }),
      }),
      params({ query: { userAction: `I ask ${nfc} about the amulet.` } }),
    )

    const ok = expectOk(out)
    const boost = (id: string) => ok.bundles.lore.traces.find((t) => t.id === id)?.kwBoostValue
    expect(boost('lore_ascii')).toBeGreaterThan(0)
    expect(boost('lore_nfd')).toBeGreaterThan(0)
  })
})
