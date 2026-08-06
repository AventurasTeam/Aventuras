import { knnQuery, unpackFloat32, vecTableName, type VecTargetKind } from '@/lib/db'
import type { EmbedderErrorKind } from '@/lib/embedder'

import { loadAwarenessForScene, type AwarenessRow } from './awareness'
import { KNN_K, RANKER_DEFAULTS } from './constants'
import {
  matchTerms,
  nameKeywordIndexFrom,
  normalizeTerm,
  type NameKeywordIndex,
} from './name-index'
import {
  buildStructuralFloor,
  filterEntityPool,
  filterLorePool,
  filterThreadPool,
  poolIdsFromKnn,
  type EntityRow,
  type KnnHit,
  type StructuralFloor,
} from './pools'
import {
  buildQueryStack,
  distributeQueryVectors,
  type QueryStack,
  type QueryStackInput,
} from './queries'
import { rankAll } from './ranker'
import {
  loadChapterRanges,
  loadSourceRows,
  staleCountsOf,
  type SourceRows,
  type Stale,
} from './source-rows'
import { classifyEmbedderFailure, runSyncStage, type SyncStageDeps } from './sync'
import { countTokens } from './tokens'
import {
  isHappeningCandidate,
  TYPE_OF_KIND,
  type Candidate,
  type QueryAll,
  type QueryPresence,
  type RankedType,
  type RetrievalType,
} from './types'
import { cosine } from './vector'

// branchIds is omitted deliberately: runRetrieval derives the sync scope from
// params.branchId, so a caller cannot declare one branch and retrieve another —
// the mismatch that would sync nothing and then KNN an unsynced index.
export type RetrievalDeps = Omit<SyncStageDeps, 'branchIds'> & {
  queryAll: QueryAll
  embedTexts: (
    texts: string[],
    abortSignal?: AbortSignal,
  ) => Promise<{ vectors: Float32Array[]; dim: number }>
}

export type RetrievalParams = {
  branchId: string
  modelId: string
  dim: number
  budgets: Record<RetrievalType, number>
  /** The floor supplies the scene / location / thread lines, so they are not accepted here. */
  query: Omit<
    QueryStackInput,
    'index' | 'sceneEntityNames' | 'currentLocationName' | 'activeThreadTitles'
  >
  sceneCharacterIds: readonly string[]
  sceneEntityIds: readonly string[]
  currentLocationId: string | null
  /** Un-classified buffer prose, for Layer-A suppression. */
  recentProse: string
}

/**
 * Wall-clock cost of one pass, in ms, for the AC7 timing log. The four stages
 * are disjoint sub-spans of `totalMs`; what is left over is the source-row,
 * awareness and chapter-range reads plus floor and query-stack assembly.
 */
export type RetrievalTimings = {
  totalMs: number
  /** Blocking embed of every row a classifier dirtied since the last pass. */
  syncMs: number
  /** The one embedder call behind the three-vector query stack. */
  embedMs: number
  /** Every vec0 KNN round trip, summed over the five types and three queries. */
  knnMs: number
  /** Scoring, MMR, and the eager token estimate the ranker costs each pool row. */
  rankMs: number
}

/** Blocking failure from either embedder call the pass makes — the sync's or the query's. */
export type RetrievalFailure = {
  reason: EmbedderErrorKind
  detail: string
  /**
   * Rows the sync stage was trying to embed. Null when there is no magnitude to
   * report: the dirty set itself failed to load, or the sync succeeded and the
   * query embed is what failed.
   */
  staleCount: number | null
}

export type RetrievalOutcome =
  | {
      ok: true
      floor: StructuralFloor
      bundles: Record<RetrievalType, RankedType>
      queries: QueryStack
      /**
       * A tripwire, not a report. The sync stage is blocking and clears the flag
       * on every row it embeds, so each count here is structurally 0 — a
       * non-zero one means the sync's scope or its ops missed rows.
       */
      staleCounts: Record<RetrievalType, number>
      /**
       * Awareness rows behind every selected happening — retrieval_count
       * targets. Duplicate-free by construction (disjoint per-happening
       * buckets, each happening selected once), which is what lets the caller
       * bump one counter per element without de-duplicating first.
       */
      injectedAwarenessIds: string[]
      /**
       * Which of `bundles.entities.selected` are places. A Candidate's `kind` is
       * the VecTargetKind ('entity'), not the EntityKind, and this pass is the
       * last place that still holds the source row — without this a prompt
       * cannot tell a retrieved location from a retrieved character, and an
       * instruction naming "the IDs above" would point at a set that can be all
       * characters.
       */
      selectedLocationIds: string[]
      timings: RetrievalTimings
    }
  | { ok: false; failure: RetrievalFailure }

/** The ok arm alone — what a caller holds once it has checked `ok`. */
export type RetrievalSuccess = Extract<RetrievalOutcome, { ok: true }>

const KINDS = Object.keys(TYPE_OF_KIND) as VecTargetKind[]

// A dim family only exists once the sync stage has embedded something into it,
// so an absent table is a cold start, not a fault: a story that needs no lead
// entity (creative mode, third person) embeds nothing at creation, and vec0
// answers the first turn's KNN with an opaque "no such table". Checked rather
// than caught so a genuine SQL fault still surfaces.
async function loadExistingVecTables(
  queryAll: RetrievalDeps['queryAll'],
  dim: number,
): Promise<ReadonlySet<string>> {
  const names = KINDS.map((kind) => vecTableName(kind, dim))
  const rows = await queryAll(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${names.map(() => '?').join(', ')})`,
    names,
  )
  return new Set(rows.map((row) => String(row[0])))
}

export async function runRetrieval(
  deps: RetrievalDeps,
  params: RetrievalParams,
): Promise<RetrievalOutcome> {
  try {
    return await runRetrievalPass(deps, params)
  } catch (error) {
    // cosine's dim and unit-norm guards, unpackFloat32's blob-length check and
    // the KNN-hit vector invariant all mean the same thing: this branch's stored
    // vectors do not match the model this pass reads. That is an embedder
    // problem, so it takes the embedder surface — Switch embedder — rather than
    // escaping as a generic orchestrator error whose only offer is a Retry that
    // fails identically every time.
    return { ok: false, failure: { ...classifyEmbedderFailure(error), staleCount: null } }
  }
}

async function runRetrievalPass(
  deps: RetrievalDeps,
  params: RetrievalParams,
): Promise<RetrievalOutcome> {
  const startedAt = performance.now()

  // No KNN without a preceding sync (retrieval.md → Compute lifecycle), and
  // every read below depends on the embedding_stale flags this clears.
  const sync = await runSyncStage({ ...deps, branchIds: [params.branchId] })
  const syncMs = performance.now() - startedAt
  if (!sync.ok) {
    return {
      ok: false,
      failure: { reason: sync.reason, detail: sync.detail, staleCount: sync.staleCount },
    }
  }

  const sourceRows = await loadSourceRows(deps.queryAll, params.branchId)
  const index = nameKeywordIndexFrom(sourceRows.entities, sourceRows.lore)
  const awareness = await loadAwarenessForScene(
    deps.queryAll,
    params.branchId,
    params.sceneCharacterIds,
  )

  const floor = buildStructuralFloor({
    entities: sourceRows.entities,
    lore: sourceRows.lore,
    threads: sourceRows.threads,
    sceneEntityIds: params.sceneEntityIds,
    currentLocationId: params.currentLocationId,
  })

  const queries = buildQueryStack({
    ...params.query,
    index,
    sceneEntityNames: floor.sceneEntities.map((e) => e.name),
    currentLocationName: floor.currentLocation?.name ?? null,
    activeThreadTitles: floor.activeThreads.map((t) => t.title),
  })

  const embedStartedAt = performance.now()
  const embed = await embedQueries(deps, params, queries.embedTexts)
  const embedMs = performance.now() - embedStartedAt
  if (!embed.ok) return embed

  const queryVectors = distributeQueryVectors(embed.vectors, queries.presence)
  // Derived from the vectors, not from queries.presence: a short embed result
  // nulls a slot the flag still reports present, and weighting an all-zero query
  // drags every candidate uniformly toward the noise floor.
  const presence: QueryPresence = [
    queryVectors[0] !== null,
    queryVectors[1] !== null,
    queryVectors[2] !== null,
  ]

  const poolCtx = {
    existingVecTables: await loadExistingVecTables(deps.queryAll, params.dim),
    queryVectors,
    index,
    floor,
    sourceRows,
    awareness,
    recentProse: params.recentProse,
    // kw_boost is keyword_boost(c, queries) (retrieval.md → Pseudocode): the
    // present query texts, which is where the era name and the piggyback
    // summary become keyword surfaces.
    queryText: queries.embedTexts.join('\n'),
  }

  // A literal, not a built-up Record, so a missing key is a build error here
  // rather than an undefined pool rankPerType throws on. RetrievalType derives
  // from TYPE_OF_KIND, so a kind added there fails this until it is seated.
  const pools: Record<RetrievalType, Candidate[]> = {
    entities: [],
    lore: [],
    happenings: [],
    threads: [],
    chapters: [],
  }
  let knnMs = 0
  for (const kind of KINDS) {
    const pool = await buildPool(deps, params, { ...poolCtx, kind })
    pools[TYPE_OF_KIND[kind]] = pool.candidates
    knnMs += pool.knnMs
  }

  const chapterRanges = await loadChapterRanges(deps.queryAll, params.branchId)

  const rankStartedAt = performance.now()
  const bundles = rankAll({
    pools,
    budgets: params.budgets,
    params: RANKER_DEFAULTS,
    presence,
    chapterRanges,
    countTokens,
  })
  const rankMs = performance.now() - rankStartedAt

  const placeIds = new Set(
    sourceRows.entities.filter((e) => e.kind === 'location').map((e) => e.id),
  )

  return {
    ok: true,
    floor,
    bundles,
    queries,
    staleCounts: staleCountsOf(sourceRows),
    injectedAwarenessIds: bundles.happenings.selected
      .filter(isHappeningCandidate)
      .flatMap((c) => [...c.awarenessIds]),
    selectedLocationIds: bundles.entities.selected
      .filter((c) => placeIds.has(c.id))
      .map((c) => c.id),
    timings: { totalMs: performance.now() - startedAt, syncMs, embedMs, knnMs, rankMs },
  }
}

/**
 * runSyncStage short-circuits before it ever reaches the embedder on a turn that
 * dirtied nothing, so this is where a dead provider first surfaces — it has to
 * fail the same typed, blocking way (model-management.md → Failure surfaces).
 */
async function embedQueries(
  deps: RetrievalDeps,
  params: RetrievalParams,
  texts: string[],
): Promise<
  { ok: true; vectors: readonly Float32Array[] } | { ok: false; failure: RetrievalFailure }
> {
  // A zero-input embed request is provider-dependent, so it is skipped outright.
  if (texts.length === 0) return { ok: true, vectors: [] }

  let embedded: { vectors: Float32Array[]; dim: number }
  try {
    embedded = await deps.embedTexts(texts, deps.abortSignal)
  } catch (error) {
    return { ok: false, failure: { ...classifyEmbedderFailure(error), staleCount: null } }
  }

  // A provider may serve a dim other than the one requested (lib/embedder →
  // embedTexts): the sync wrote the served family while the KNN below reads
  // params.dim, and vec0 rejects the mismatched blob with an opaque error.
  if (embedded.dim !== params.dim) {
    return {
      ok: false,
      failure: {
        reason: 'call',
        detail: `query embed served dim ${embedded.dim}, but this pass reads the dim-${params.dim} vec0 family`,
        staleCount: null,
      },
    }
  }
  return { ok: true, vectors: embedded.vectors }
}

type PoolCtx = {
  kind: VecTargetKind
  existingVecTables: ReadonlySet<string>
  queryVectors: readonly (Float32Array | null)[]
  index: NameKeywordIndex
  floor: StructuralFloor
  sourceRows: SourceRows
  awareness: readonly AwarenessRow[]
  recentProse: string
  queryText: string
}

async function buildPool(
  deps: RetrievalDeps,
  params: RetrievalParams,
  ctx: PoolCtx,
): Promise<{ candidates: Candidate[]; knnMs: number }> {
  const vectorById = new Map<string, Float32Array>()
  const perQuery: KnnHit[][] = []
  let knnMs = 0

  if (!ctx.existingVecTables.has(vecTableName(ctx.kind, params.dim)))
    return { candidates: [], knnMs }

  for (const vector of ctx.queryVectors) {
    if (vector === null) {
      perQuery.push([])
      continue
    }
    const query = knnQuery(ctx.kind, params.dim, {
      branchId: params.branchId,
      modelId: params.modelId,
      k: KNN_K,
      vector: new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength),
    })
    const knnStartedAt = performance.now()
    const rows = await deps.queryAll(query.sql, query.params)
    knnMs += performance.now() - knnStartedAt
    perQuery.push(
      rows.map((row) => {
        const id = String(row[0])
        // vec0 returns each row's embedding on the match row, so the union below
        // needs no second fetch by id.
        if (!vectorById.has(id)) vectorById.set(id, unpackFloat32(row[2] as Uint8Array))
        return [id, Number(row[1])] as const
      }),
    )
  }

  const ids = poolIdsFromKnn(perQuery)
  return { candidates: ids.length === 0 ? [] : assembleCandidates(ctx, ids, vectorById), knnMs }
}

const fresh = <T extends Stale>(rows: readonly T[]): T[] => rows.filter((r) => !r.embeddingStale)

/**
 * Canon frames two of the three sub-pools (retrieval.md → Three-sub-pool entity
 * model), so the model reads an active pool row as elsewhere rather than present
 * and a staged one as introducible rather than as cast. Retired has no framing,
 * hence Partial. The memory-blocks macro repeats these words for pinned rows,
 * which never reach the ranker; memory-blocks.test.ts pins the two together.
 */
export const ENTITY_FRAMING: Partial<Record<EntityRow['status'], string>> = {
  active: 'currently elsewhere',
  staged: 'available to introduce',
}

// A blank field must not leave its separator behind: a null description renders
// "Mira: " to the model, which reads as a truncated line rather than an absent
// one, and the ranker charges the budget for it either way.
const lines = (...parts: (string | null)[]): string =>
  parts.filter((p) => p !== null && p !== '').join('\n')

/** The one place KNN ids, vectors, source rows and pool predicates meet. */
function assembleCandidates(
  ctx: PoolCtx,
  ids: readonly string[],
  vectorById: ReadonlyMap<string, Float32Array>,
): Candidate[] {
  const { index, floor, sourceRows, awareness, queryVectors } = ctx
  const wanted = new Set(ids)

  const sim = (vector: Float32Array, query: Float32Array | null): number =>
    query === null ? 0 : cosine(vector, query)
  const simsFor = (vector: Float32Array): readonly [number, number, number] => [
    sim(vector, queryVectors[0]),
    sim(vector, queryVectors[1]),
    sim(vector, queryVectors[2]),
  ]

  // kw = keyword_boost(c, queries) (retrieval.md → Pseudocode) runs the
  // candidate's own keyword surface against this turn's queries. The other
  // direction — a candidate against the name index — is degenerate, since every
  // row's own terms are in that index by construction.
  const kwHits = (surface: readonly string[]): string[] =>
    matchTerms(ctx.queryText, surface.map(normalizeTerm))

  const inPool = <T extends { id: string }>(rows: readonly T[]): T[] =>
    rows.filter((r) => wanted.has(r.id))

  // Invariant, not a runtime case: every id here came from a KNN row that
  // carried its own vector.
  const vectorFor = (id: string): Float32Array => {
    const vector = vectorById.get(id)
    if (vector === undefined) throw new Error(`runRetrieval: KNN hit ${id} carried no vector`)
    return vector
  }

  // Rebuilt per candidate: awarenessIds is an array, and one instance spread
  // across a pool would alias every candidate's list.
  const shared = () => ({
    // Stale rows keep their old vector in vec0 and stay reachable by KNN, so
    // each pool below drops them; everything that survives is fresh.
    embeddingStale: false,
    // Mapping a row to a chapter distance needs the chapter-close pipeline (M5);
    // until then every row reads as current and recency_factor is 1.
    chaptersOld: 0,
  })

  switch (ctx.kind) {
    case 'entity': {
      const pool = filterEntityPool(fresh(sourceRows.entities), {
        floorIds: floor.seatedIds,
        recentProse: ctx.recentProse,
      })
      return inPool(pool).map((r) => {
        const vector = vectorFor(r.id)
        const framing = ENTITY_FRAMING[r.status]
        const head = framing === undefined ? r.name : `${r.name} (${framing})`
        return {
          ...shared(),
          kind: 'entity' as const,
          id: r.id,
          displayName: r.name,
          renderedText: r.description ? `${head}: ${r.description}` : head,
          sims: simsFor(vector),
          vector,
          pinSignal: 0,
          keywordHits: kwHits([r.name]),
        }
      })
    }

    case 'lore': {
      const pool = filterLorePool(fresh(sourceRows.lore), floor.seatedIds)
      return inPool(pool).map((r) => {
        const vector = vectorFor(r.id)
        return {
          ...shared(),
          kind: 'lore' as const,
          id: r.id,
          displayName: r.title,
          renderedText: lines(r.title, r.body),
          sims: simsFor(vector),
          vector,
          pinSignal: r.priority / 100,
          keywordHits: kwHits(r.keywords),
        }
      })
    }

    case 'happening': {
      const byHappening = new Map<string, AwarenessRow[]>()
      for (const a of awareness) {
        const bucket = byHappening.get(a.happeningId)
        if (bucket) bucket.push(a)
        else byHappening.set(a.happeningId, [a])
      }
      // `awareness` is already the in-scene POV union (retrieval.md →
      // POV-awareness scope), so membership here IS the POV filter; common
      // knowledge bypasses the graph outright.
      const pool = fresh(sourceRows.happenings).filter(
        (r) => r.commonKnowledge || byHappening.has(r.id),
      )
      return inPool(pool).map((r) => {
        const vector = vectorFor(r.id)
        const rows = byHappening.get(r.id) ?? []
        return {
          ...shared(),
          kind: 'happening' as const,
          id: r.id,
          displayName: r.title,
          renderedText: lines(r.title, r.description, ...rows.map((a) => a.source)),
          sims: simsFor(vector),
          vector,
          commonKnowledge: r.commonKnowledge,
          // Common knowledge carries no decay_resistance signal (retrieval.md →
          // Why on awareness only); nothing in the schema stops such a row from
          // also having awareness rows, so the zero is conditional on the flag.
          pinSignal: r.commonKnowledge
            ? 0
            : Math.max(0, ...rows.map((a) => a.decayResistance ?? 0)),
          occurredAtEntryId: r.occurredAtEntryId,
          awarenessIds: rows.map((a) => a.id),
          // Awareness `source` strings are freeform descriptors, not term lists,
          // so the surface is the entity names they name verbatim — computed
          // per candidate over its own sources, never as a corpus index (up to
          // ~60k rows at 60 chapters, per retrieval.md → Scale assumptions).
          keywordHits: kwHits(
            matchTerms(rows.map((a) => a.source ?? '').join(' '), index.entityNames),
          ),
        }
      })
    }

    case 'thread': {
      const pool = filterThreadPool(fresh(sourceRows.threads), floor.seatedIds)
      return inPool(pool).map((r) => {
        const vector = vectorFor(r.id)
        return {
          ...shared(),
          kind: 'thread' as const,
          id: r.id,
          displayName: r.title,
          // Status is content, not decoration: the pool is pending / resolved /
          // failed, and "resolved means done, failed is distinct" (data-model.md
          // → threads) is exactly what a lone title loses. In renderedText so
          // the ranker charges the budget for it.
          renderedText: lines(`${r.title} (${r.status})`, r.description),
          sims: simsFor(vector),
          vector,
          pinSignal: 0,
          keywordHits: [],
        }
      })
    }

    case 'chapter': {
      // Every chapters row is closed by construction, so there is no status
      // predicate to apply.
      return inPool(fresh(sourceRows.chapters)).map((r) => {
        const vector = vectorFor(r.id)
        return {
          ...shared(),
          kind: 'chapter' as const,
          id: r.id,
          displayName: r.title,
          // The title is here rather than on a `##` line in the macro because
          // only renderedText is measured; a variable-length string outside it
          // overruns the type budget by its own length times the row count.
          renderedText: lines(r.title, r.summary, r.theme),
          sims: simsFor(vector),
          vector,
          pinSignal: 0,
          keywordHits: kwHits(r.keywords),
        }
      })
    }
  }
}
