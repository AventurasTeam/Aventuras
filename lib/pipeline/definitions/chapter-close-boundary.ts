import { and, desc, eq } from 'drizzle-orm'

import { canEndChapter, closeCandidates, fallbackChapterEnd } from '@/lib/chapters'
import { chapters, deltas, openRegionSeries } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { generationStore } from '@/lib/stores'

import {
  hasCandidates,
  readBoundaryInputs,
  requestChapterBoundary,
} from './chapter-close-boundary-call'
import { setCloseRange } from './close-intermediates'
import { CLOSE_PHASE } from './intermediates'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '../types'

function refuse(detail: string): PhaseResult {
  return {
    status: 'failed',
    error: { kind: 'phase-logic', detail, phaseName: CLOSE_PHASE.boundary },
  }
}

// Dropped so the next Send owes nothing on it; a threshold close is still read fresh by closeOwed.
function refuseStalePick(branchId: string, detail: string): PhaseResult {
  generationStore.clearPendingClose(branchId)
  return refuse(detail)
}

function parkRange(ctx: PhaseContext, startEntryId: string, endEntryId: string): PhaseResult {
  setCloseRange(ctx.intermediates, { chapterId: generateId('chap'), startEntryId, endEntryId })
  return { status: 'completed' }
}

// chapter-close.md → Re-running a close: the chapter's own range; latest, close-written only.
async function parkRerunRange(ctx: PhaseContext, chapterId: string): Promise<PhaseResult> {
  const [chapter] = await ctx.db
    .select({
      sequenceNumber: chapters.sequenceNumber,
      startEntryId: chapters.startEntryId,
      endEntryId: chapters.endEntryId,
    })
    .from(chapters)
    .where(and(eq(chapters.branchId, ctx.branchId), eq(chapters.id, chapterId)))
  if (!chapter)
    return refuse(`chapter-close: no chapter ${chapterId} to re-run on branch ${ctx.branchId}`)
  const [latest] = await ctx.db
    .select({ sequenceNumber: chapters.sequenceNumber })
    .from(chapters)
    .where(eq(chapters.branchId, ctx.branchId))
    .orderBy(desc(chapters.sequenceNumber))
    .limit(1)
  if (latest?.sequenceNumber !== chapter.sequenceNumber)
    return refuse(
      `chapter-close: chapter ${chapter.sequenceNumber} is not the latest; ${latest?.sequenceNumber} is`,
    )
  const [closed] = await ctx.db
    .select({ id: deltas.id })
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, ctx.branchId),
        eq(deltas.targetTable, 'chapters'),
        eq(deltas.targetId, chapterId),
        eq(deltas.source, 'chapter_close'),
      ),
    )
    .limit(1)
  if (!closed) return refuse(`chapter-close: no close wrote chapter ${chapterId}`)
  setCloseRange(ctx.intermediates, {
    chapterId,
    startEntryId: chapter.startEntryId,
    endEntryId: chapter.endEntryId,
  })
  return { status: 'completed' }
}

/**
 * C2 → boundary: the re-run's chapter range, else the manual pick, else the model's pick among
 * Phase 1's candidates, else the no-model fallback (chapter-close.md → Phase 1). Gate held here.
 */
export async function* closeBoundaryPhase(
  ctx: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  // The record holds the branch for its chain's life: a close it holds is that chapter's re-run.
  const rerun = generationStore.getTxState().pendingRerun.get(ctx.branchId)
  if (rerun !== undefined) return await parkRerunRange(ctx, rerun.chapterId)
  const series = await openRegionSeries(ctx.branchId, ctx)
  // Read past the await, so the pick checked is the pick dropped.
  const pick = generationStore.getTxState().pendingClose.get(ctx.branchId)
  if (pick) {
    const end = series.find((row) => row.id === pick.endEntryId)
    if (!end)
      return refuseStalePick(
        ctx.branchId,
        `chapter-close: end entry ${pick.endEntryId} is not in the open region`,
      )
    if (!canEndChapter(end))
      return refuseStalePick(
        ctx.branchId,
        `chapter-close: a chapter can't end on ${end.kind} entry ${end.id}`,
      )
    return parkRange(ctx, series[0].id, end.id)
  }
  const inputs = readBoundaryInputs(ctx)
  if ('status' in inputs) return inputs
  const candidates = closeCandidates(series, inputs.threshold)
  if (!hasCandidates(candidates)) {
    // closeOwed owes no close to a region with no reply (C10), so this refusal is a backstop.
    const end = fallbackChapterEnd(series)
    if (!end)
      return refuse(`chapter-close: branch ${ctx.branchId} has no open-region reply to end on`)
    return parkRange(ctx, series[0].id, end.id)
  }
  // Every usable answer names the lone candidate, so a call could only fail the close.
  if (candidates.length === 1) return parkRange(ctx, series[0].id, candidates[0].id)
  const call = yield* requestChapterBoundary(ctx, candidates, inputs)
  switch (call.status) {
    case 'picked':
    case 'unusable':
      return parkRange(ctx, series[0].id, call.endEntryId)
    case 'failed':
      return { status: 'failed', error: call.error }
    case 'aborted':
      return { status: 'aborted' }
  }
}
