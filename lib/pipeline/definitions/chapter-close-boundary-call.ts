import { and, eq, inArray } from 'drizzle-orm'

import type { ResolveModelConfig } from '@/lib/ai'
import { closeCandidateWindow, type CloseCandidate } from '@/lib/chapters'
import { storyEntries, type OpenRegionRow } from '@/lib/db'
import { promptProse } from '@/lib/piggyback'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'
import { appSettingsStore, currentStoryStore, threadsStore } from '@/lib/stores'
import { firstLastSentences, oneLine } from '@/lib/text'

import { refineBoundaryReply } from './chapter-boundary-schema'
import { CLOSE_PHASE, CLOSE_TARGET } from './intermediates'
import { storesHoldBranch } from './stores-hold-branch'
import { boundedStructuredCall } from '../bounded-structured-call'
import type { StructuredCallFailure } from '../call-error'
import type { PhaseContext, PhaseEmittedEvent, PhaseFailure, PipelineError } from '../types'

// chapter-close.md → Phase 1: the boundary reply's output bound when the settings set none.
const BOUNDARY_MAX_OUTPUT_DEFAULT = 16_384

export type BoundaryCallContext = Pick<
  PhaseContext,
  'db' | 'branchId' | 'abortSignal' | 'actionId' | 'log'
>

/** What boundary's call reads from the stores, in one synchronous section. */
export type BoundaryCallInputs = {
  threshold: number
  activeThreads: readonly { title: string }[]
  modelConfig: ResolveModelConfig
}

export type BoundaryCallOutcome =
  | { status: 'picked'; endEntryId: string }
  | { status: 'unusable'; endEntryId: string; tier: 'parse' | 'reply-cut-off' }
  | { status: 'failed'; error: PipelineError }
  | { status: 'aborted' }

type UnusableTier = Extract<BoundaryCallOutcome, { status: 'unusable' }>['tier']

type BoundaryCandidate = CloseCandidate<OpenRegionRow>

/** Phase 1's candidates, oldest first, at least one: an unusable reply ends on the last. */
export type BoundaryCandidates = readonly [BoundaryCandidate, ...BoundaryCandidate[]]

export function hasCandidates(
  candidates: readonly BoundaryCandidate[],
): candidates is BoundaryCandidates {
  return candidates.length > 0
}

/**
 * Synchronous: the threshold, the branch's active threads and lore-mgmt's config, while the check
 * holds. An open publishing during a later await replaces the stores with another branch's rows.
 */
export function readBoundaryInputs(
  ctx: Pick<PhaseContext, 'storyId' | 'branchId'>,
): BoundaryCallInputs | PhaseFailure {
  const open = currentStoryStore.getCurrentStory()
  if (!storesHoldBranch(open, ctx))
    return {
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'chapter-close: branch not loaded' },
    }
  const settings = appSettingsStore.getAppSettings()
  return {
    threshold: open.settings.chapterTokenThreshold,
    activeThreads: [...threadsStore.getThreads().values()]
      .filter((thread) => thread.branchId === ctx.branchId && thread.status === 'active')
      .map((thread) => ({ title: thread.title })),
    modelConfig: {
      providers: settings.providers,
      profiles: settings.profiles,
      assignments: settings.assignments,
      storyModels: open.settings.models,
    },
  }
}

// The series carries no content, so the candidates' prose is read by id.
async function candidateProse(
  ctx: BoundaryCallContext,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const rows = await ctx.db
    .select({ id: storyEntries.id, kind: storyEntries.kind, content: storyEntries.content })
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, ctx.branchId), inArray(storyEntries.id, [...ids])))
  return new Map(rows.map((row) => [row.id, promptProse(row)]))
}

// chapter-close.md → Phase 1's Validation: a reply unusable after its retry, or cut off, loses
// nothing; any other failure fails the close.
function unusableTier(cause: StructuredCallFailure): UnusableTier | null {
  if (cause.status !== 'failed') return null
  const { tier } = cause.error
  return tier === 'parse' || tier === 'reply-cut-off' ? tier : null
}

function fallBack(
  ctx: BoundaryCallContext,
  tier: UnusableTier,
  latest: BoundaryCandidate,
  detail: string,
): BoundaryCallOutcome {
  ctx.log.warn('memory.close_boundary_fallback', { tier, endEntryId: latest.id, detail })
  return { status: 'unusable', endEntryId: latest.id, tier }
}

/**
 * chapter-close.md → Phase 1's call over `candidates`: the model names a candidate by its turn, and
 * an unusable reply ends on the latest candidate, which keeps the chapter to at most one and a half
 * thresholds.
 */
export async function* requestChapterBoundary(
  ctx: BoundaryCallContext,
  candidates: BoundaryCandidates,
  inputs: BoundaryCallInputs,
): AsyncGenerator<PhaseEmittedEvent, BoundaryCallOutcome> {
  const prose = await candidateProse(
    ctx,
    candidates.map((candidate) => candidate.id),
  )
  // Handles are this call's own: no chapter range exists yet to share them with.
  const byTurn = new Map<string, BoundaryCandidate>()
  const boundaryCandidates = candidates.map((candidate, index) => {
    const turn = `t${index + 1}`
    byTurn.set(turn, candidate)
    const { first, last } = firstLastSentences(prose.get(candidate.id) ?? '')
    return { turn, position: candidate.position, opening: first, closing: last }
  })
  const lengths = closeCandidateWindow(inputs.threshold)
  const prompt = renderTemplate(TEMPLATE_IDS.chapterBoundary, {
    boundaryCandidates,
    boundaryLengthFrom: lengths.from,
    boundaryLengthTo: lengths.to,
    boundaryActiveThreads: inputs.activeThreads.map((thread) => ({ title: oneLine(thread.title) })),
  })
  const call = yield* boundedStructuredCall({
    target: CLOSE_TARGET,
    phaseName: CLOSE_PHASE.boundary,
    prompt,
    schema: refineBoundaryReply(new Set(byTurn.keys())),
    config: inputs.modelConfig,
    signal: ctx.abortSignal,
    options: { actionId: ctx.actionId, defaultMaxOutput: BOUNDARY_MAX_OUTPUT_DEFAULT },
  })
  if (call.status === 'aborted' || ctx.abortSignal.aborted) return { status: 'aborted' }
  const latest = candidates[candidates.length - 1]
  if (call.status === 'failed') {
    const tier = unusableTier(call.cause)
    return tier === null
      ? { status: 'failed', error: call.error }
      : fallBack(ctx, tier, latest, call.lastError)
  }
  const { end_entry_id: turn, rationale } = call.value
  const picked = byTurn.get(turn)
  // The refined schema refuses a handle no candidate holds; this guards a call it didn't parse.
  if (picked == null)
    return fallBack(ctx, 'parse', latest, `end_entry_id ${JSON.stringify(turn)} names no candidate`)
  ctx.log.debug('memory.close_boundary_picked', {
    endEntryId: picked.id,
    turn,
    rationale,
    candidates: candidates.length,
  })
  return { status: 'picked', endEntryId: picked.id }
}
