import { and, eq, inArray } from 'drizzle-orm'

import { boundedSignal } from '@/lib/abort'
import type { GroupOutcome } from '@/lib/actions/types'
import {
  chunked,
  entities,
  happeningInvolvements,
  happenings,
  queryRows,
  staleRowsQuery,
  toEmbeddedFieldRow,
  vectorsByIdQuery,
} from '@/lib/db'
import { embedderReadDim } from '@/lib/embedder'
import { composeRetrievalEmbedDeps, resolveStorySwapConfig } from '@/lib/embedder-swap'
import {
  decodeVector,
  runSyncStage,
  VectorInvariantError,
  type SyncStageDeps,
  type SyncStageResult,
} from '@/lib/retrieval'
import { storiesStore } from '@/lib/stores'

import { findClusters, type ClusterInput } from './close-clusters'
import type { CodeStep, CodeStepContext } from './slots'
import type { PhaseContext, PhaseEmittedEvent, PhaseFailure, PhaseResult } from '../../types'
import { setCloseClusters } from '../close-intermediates'
import { EMBED_TIMEOUT_MS } from '../embed-bound'

/** What the range embed needs of an embedder: per-turn retrieval's deps, and where vectors live. */
export type CloseEmbedDeps = Pick<SyncStageDeps, 'revalidateRows' | 'embedRows'> & {
  queryAll: (sql: string, params: unknown[]) => Promise<unknown[][]>
  modelId: string
  dim: number
}

type RangeHappening = { id: string; anchorIndex: number | null }

let testDeps: CloseEmbedDeps | undefined

/** Undefined restores production resolution. */
export function __setCloseEmbedDepsForTest(deps: CloseEmbedDeps | undefined): void {
  testDeps = deps
}

const TIMED_OUT = `embed timed out after ${EMBED_TIMEOUT_MS}ms`

// per-turn-retrieval.ts's envelope: an embedder the close can't reach fails it as it fails a turn.
function embedderInitFailure(detail: string): PhaseFailure {
  return { status: 'failed', error: { kind: 'embedder', reason: 'init', detail, staleCount: null } }
}

/** Per-turn retrieval's resolution, keyed by the run's story. */
function resolveCloseEmbedDeps(phase: PhaseContext): CloseEmbedDeps | PhaseFailure {
  const { storyId } = phase
  if (storyId === null)
    return embedderInitFailure('embedder not configured: the close has no story')
  const settings = storiesStore.getStories().rows.find((row) => row.id === storyId)?.settings
  if (settings == null)
    return embedderInitFailure(`embedder not configured: story ${storyId} isn't loaded`)
  const resolution = resolveStorySwapConfig(storyId, {
    modelId: settings.embedding_model_id,
    backend: settings.embeddingBackend,
    providerId: settings.embedding_provider_id,
  })
  if (!resolution.ok) return embedderInitFailure(`embedder not configured: ${resolution.reason}`)
  const dim = embedderReadDim(resolution.config)
  if (dim === null)
    return embedderInitFailure(`embedder dim unknown for model ${resolution.config.modelId}`)
  const { embedRows, revalidateRows } = composeRetrievalEmbedDeps(resolution.config)
  return { embedRows, revalidateRows, queryAll: queryRows, modelId: resolution.config.modelId, dim }
}

// `taskEntryIds` is part 0's: the range's non-system entries by position, as closeAgentPhase read them.
async function readRangeHappenings(ctx: CodeStepContext): Promise<RangeHappening[]> {
  const indexOf = new Map(ctx.taskEntryIds.map((id, index) => [id, index] as const))
  const rows: RangeHappening[] = []
  for (const ids of chunked(ctx.taskEntryIds)) {
    const found = await ctx.db
      .select({ id: happenings.id, occurredAtEntryId: happenings.occurredAtEntryId })
      .from(happenings)
      .where(and(eq(happenings.branchId, ctx.branchId), inArray(happenings.occurredAtEntryId, ids)))
    for (const { id, occurredAtEntryId } of found)
      rows.push({
        id,
        anchorIndex: occurredAtEntryId === null ? null : (indexOf.get(occurredAtEntryId) ?? null),
      })
  }
  return rows
}

// The sync stage's loader narrowed to the range: other kinds and happenings wait for the next sync.
function staleInRange(
  deps: CloseEmbedDeps,
  inRange: ReadonlySet<string>,
): SyncStageDeps['loadStaleRows'] {
  return async (branchIds) => {
    const { sql, params } = staleRowsQuery('happening', branchIds)
    const rows = await deps.queryAll(sql, params)
    return rows
      .map((raw) => toEmbeddedFieldRow('happening', raw))
      .filter((row) => inRange.has(row.id))
  }
}

async function readVectors(
  deps: CloseEmbedDeps,
  branchId: string,
  ids: readonly string[],
): Promise<Map<string, Float32Array>> {
  const vectors = new Map<string, Float32Array>()
  for (const chunk of chunked(ids)) {
    const { sql, params } = vectorsByIdQuery('happening', deps.dim, {
      branchId,
      modelId: deps.modelId,
      ids: chunk,
    })
    for (const [id, embedding] of await deps.queryAll(sql, params))
      vectors.set(String(id), decodeVector(embedding))
  }
  return vectors
}

async function readCasts(
  ctx: CodeStepContext,
  ids: readonly string[],
): Promise<Map<string, Set<string>>> {
  const casts = new Map<string, Set<string>>()
  for (const chunk of chunked(ids)) {
    const links = await ctx.db
      .select({
        happeningId: happeningInvolvements.happeningId,
        entityId: happeningInvolvements.entityId,
      })
      .from(happeningInvolvements)
      .innerJoin(
        entities,
        and(
          eq(entities.branchId, happeningInvolvements.branchId),
          eq(entities.id, happeningInvolvements.entityId),
        ),
      )
      .where(
        and(
          eq(happeningInvolvements.branchId, ctx.branchId),
          inArray(happeningInvolvements.happeningId, chunk),
          eq(entities.kind, 'character'),
        ),
      )
    for (const { happeningId, entityId } of links) {
      const cast = casts.get(happeningId) ?? new Set<string>()
      cast.add(entityId)
      casts.set(happeningId, cast)
    }
  }
  return casts
}

// The outer signal was read first, so a cancel here is the bound's, or an embedder that cancelled
// unasked, which reads as a stop as per-turn retrieval reads it.
function syncFailure(sync: Extract<SyncStageResult, { ok: false }>, expired: boolean): PhaseResult {
  if (sync.cancelled === true) {
    if (!expired) return { status: 'aborted' }
    return {
      status: 'failed',
      error: { kind: 'embedder', reason: 'call', detail: TIMED_OUT, staleCount: null },
    }
  }
  return {
    status: 'failed',
    error: {
      kind: 'embedder',
      reason: sync.reason,
      detail: expired ? TIMED_OUT : sync.detail,
      staleCount: sync.staleCount,
    },
  }
}

/**
 * chapter-close.md → 3e: embeds the range's happenings, then parks the clusters they form for the
 * Happenings task. Emits nothing and records nothing; an embedder failure fails the close.
 */
async function* embedRange(
  ctx: CodeStepContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult, GroupOutcome | undefined> {
  const { phase, branchId } = ctx
  const range = await readRangeHappenings(ctx)
  if (range.length < 2) return { status: 'completed' }
  const deps = testDeps ?? resolveCloseEmbedDeps(phase)
  if ('status' in deps) return deps

  const ids = range.map(({ id }) => id)
  const bounded = boundedSignal(phase.abortSignal, EMBED_TIMEOUT_MS)
  let sync: SyncStageResult
  try {
    // generation-pipeline.md → Writes: vec0 rows and flags outside the delta log, on the run's handle.
    sync = await runSyncStage({
      branchIds: [branchId],
      abortSignal: bounded.signal,
      loadStaleRows: staleInRange(deps, new Set(ids)),
      revalidateRows: deps.revalidateRows,
      embedRows: deps.embedRows,
      runInTransaction: phase.runInTransaction,
    })
  } finally {
    bounded.dispose()
  }
  if (phase.abortSignal.aborted) return { status: 'aborted' }
  if (!sync.ok) return syncFailure(sync, bounded.expired())

  let clusters: string[][]
  let unembedded: number
  try {
    // The sync reports ok even when a writer's edit made its guarded clear match nothing: such a
    // row keeps its old vector and its flag, and retrieval leaves it out as stale.
    const stillStale = new Set(
      (await staleInRange(deps, new Set(ids))([branchId])).map(({ id }) => id),
    )
    const vectors = await readVectors(
      deps,
      branchId,
      ids.filter((id) => !stillStale.has(id)),
    )
    const casts = await readCasts(ctx, ids)
    const inputs = range.flatMap(({ id, anchorIndex }): ClusterInput[] => {
      const vector = vectors.get(id)
      return vector === undefined
        ? []
        : [{ id, vector, cast: casts.get(id) ?? new Set<string>(), anchorIndex }]
    })
    unembedded = range.length - inputs.length
    clusters = findClusters(inputs)
  } catch (error) {
    // As per-turn retrieval routes it: stored vectors this model can't read take the embedder
    // surface (Switch embedder); anything else is no embedder fault and escapes.
    if (!(error instanceof VectorInvariantError)) throw error
    return embedderInitFailure(error.message)
  }
  setCloseClusters(phase.intermediates, clusters)
  phase.log.debug('memory.close_range_embed', {
    happenings: range.length,
    embedded: sync.embedded,
    revalidated: sync.revalidated,
    unembedded,
    clusters: clusters.length,
  })
  return { status: 'completed' }
}

export const embedRangeStep: CodeStep = { name: 'happenings-embed', run: embedRange }
