import { eq, sql } from 'drizzle-orm'

import type { GroupOutcome, PipelineAction } from '@/lib/actions/types'
import {
  generationWindow,
  resolveModel,
  type ResolveModelConfig,
  type ResolveTarget,
} from '@/lib/ai'
import { cutChapterParts } from '@/lib/chapters'
import { chapters, openRegionSeries, type DbCtx, type OpenRegionRow } from '@/lib/db'

import { readMetadataInputs, requestChapterMetadata } from './chapter-close-metadata-call'
import { requireCloseRange, setCloseParts } from './close-intermediates'
import { CLOSE_PHASE } from './intermediates'
import { emitDeltaGroup } from '../runtime/emit-group'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult, PipelineError } from '../types'

const TARGET = 'lore-mgmt' satisfies ResolveTarget

/** The open-region rows from the first through `endEntryId`; null when the end isn't among them. */
export function closeSeriesThrough(
  series: readonly OpenRegionRow[],
  endEntryId: string,
): readonly OpenRegionRow[] | null {
  const end = series.findIndex((row) => row.id === endEntryId)
  return end === -1 ? null : series.slice(0, end + 1)
}

/** architecture.md → The window figure, for lore-mgmt's resolved model, a story override's included. */
export function closeWindowTokens(
  config: ResolveModelConfig,
): { ok: true; tokens: number | null } | { ok: false; error: PipelineError } {
  const resolved = resolveModel(TARGET, config)
  if (!resolved.ok)
    return {
      ok: false,
      error: {
        kind: 'config-resolver',
        failure: resolved.kind,
        target: TARGET,
        phaseName: CLOSE_PHASE.metadata,
      },
    }
  return {
    ok: true,
    tokens: generationWindow(config.providers, resolved.providerId, resolved.modelId).tokens,
  }
}

async function nextSequenceNumber(db: DbCtx['db'], branchId: string): Promise<number> {
  const [row] = await db
    .select({ next: sql<number>`COALESCE(MAX(${chapters.sequenceNumber}), 0) + 1` })
    .from(chapters)
    .where(eq(chapters.branchId, branchId))
  return row?.next ?? 1
}

// A whole refusal points at no one action, so its detail names each kind the group held, counted.
function groupKinds(actions: readonly PipelineAction[]): string {
  const counts = new Map<string, number>()
  for (const { kind } of actions) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  return [...counts].map(([kind, count]) => (count === 1 ? kind : `${count} ${kind}`)).join(' and ')
}

// A chapter row must sit over a fully stamped range: any action that didn't land fails the close.
function notApplied(actions: readonly PipelineAction[], outcome: GroupOutcome): string | null {
  if (outcome.status === 'rejected')
    return `chapter-close: ${groupKinds(actions)} not applied: ${outcome.reason}`
  // A short answer would let the missing actions read as landed.
  if (outcome.outcomes.length !== actions.length)
    return `chapter-close: group not applied: ${outcome.outcomes.length} outcomes for ${actions.length} actions`
  for (const [index, result] of outcome.outcomes.entries())
    if (result.status !== 'landed')
      return `chapter-close: ${actions[index].kind} not applied: ${result.reason}`
  return null
}

/**
 * chapter-close.md → Phase 2: the range cut into parts (Parts), the metadata call, then the row and
 * a stamp per entry through the end as one group, in C1's order, every delta anchored on the end
 * entry.
 */
export async function* closeMetadataPhase(
  ctx: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult, GroupOutcome | undefined> {
  const range = requireCloseRange(ctx)
  if ('status' in range) return range
  const inputs = readMetadataInputs(ctx)
  if ('status' in inputs) return inputs

  // Unstamped until the group, so the open region still holds the whole range.
  const region = await openRegionSeries(ctx.branchId, ctx)
  const series = closeSeriesThrough(region, range.endEntryId)
  // The gate makes this unreachable; stamping a range that moved would cost more than the check.
  if (!series)
    return {
      status: 'failed',
      error: {
        kind: 'phase-logic',
        phaseName: CLOSE_PHASE.metadata,
        detail: `chapter-close: end entry ${range.endEntryId} is not in the open region`,
      },
    }
  const window = closeWindowTokens(inputs.modelConfig)
  if (!window.ok) return { status: 'failed', error: window.error }
  setCloseParts(ctx.intermediates, cutChapterParts(series, window.tokens))

  const call = yield* requestChapterMetadata(ctx, range, inputs)
  if (call.status === 'aborted') return { status: 'aborted' }
  if (call.status === 'failed') return { status: 'failed', error: call.error }

  const sequenceNumber = await nextSequenceNumber(ctx.db, ctx.branchId)
  const { title, summary, theme, keywords } = call.metadata
  const now = Date.now()

  // The group commits whole: a cancel after this is reversed by the orchestrator, not stopped.
  if (ctx.abortSignal.aborted) return { status: 'aborted' }
  const actions: PipelineAction[] = [
    {
      kind: 'createChapter',
      source: 'chapter_close',
      payload: {
        entry: {
          id: range.chapterId,
          branchId: ctx.branchId,
          sequenceNumber,
          title,
          summary,
          theme,
          keywords,
          startEntryId: range.startEntryId,
          endEntryId: range.endEntryId,
          tokenCount: series.reduce((sum, row) => sum + row.tokens, 0),
          closedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      },
    },
    ...series.map(
      (row): PipelineAction => ({
        kind: 'stampEntryChapter',
        source: 'chapter_close',
        payload: { branchId: ctx.branchId, id: row.id, chapterId: range.chapterId },
      }),
    ),
  ]
  const outcome = yield* emitDeltaGroup(actions, range.endEntryId)
  const refused = notApplied(actions, outcome)
  if (refused !== null)
    return { status: 'failed', error: { kind: 'action-layer', detail: refused } }
  return { status: 'completed' }
}
