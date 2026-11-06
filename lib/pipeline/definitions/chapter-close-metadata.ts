import { eq, sql } from 'drizzle-orm'

import { chapters, openRegionSeries, type DbCtx, type OpenRegionRow } from '@/lib/db'

import { requestChapterMetadata } from './chapter-close-metadata-call'
import { CLOSE_PHASE, CLOSE_RANGE_INTERMEDIATE_KEY, type CloseRange } from './intermediates'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '../types'

/** The open-region rows from the first through `endEntryId`; null when the end isn't among them. */
export function closeSeriesThrough(
  series: readonly OpenRegionRow[],
  endEntryId: string,
): readonly OpenRegionRow[] | null {
  const end = series.findIndex((row) => row.id === endEntryId)
  return end === -1 ? null : series.slice(0, end + 1)
}

async function nextSequenceNumber(db: DbCtx['db'], branchId: string): Promise<number> {
  const [row] = await db
    .select({ next: sql<number>`COALESCE(MAX(${chapters.sequenceNumber}), 0) + 1` })
    .from(chapters)
    .where(eq(chapters.branchId, branchId))
  return row?.next ?? 1
}

/**
 * chapter-close.md → Phase 2: one metadata call for the whole chapter, with no parts yet (Slice
 * 5.8), then the row and one stamp per entry through the end, in position order, every write
 * anchored on the end entry (C1).
 */
export async function* closeMetadataPhase(
  ctx: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  const range = ctx.intermediates[CLOSE_RANGE_INTERMEDIATE_KEY] as CloseRange | undefined
  if (!range)
    return {
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'chapter-close: no close range' },
    }
  const call = yield* requestChapterMetadata(ctx, range)
  if (call.status === 'aborted') return { status: 'aborted' }
  if (call.status === 'failed') return { status: 'failed', error: call.error }

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
  const sequenceNumber = await nextSequenceNumber(ctx.db, ctx.branchId)
  const { title, summary, theme, keywords } = call.metadata
  const now = Date.now()

  // C1: the orchestrator reads an abort only between phases, and each write commits on its own.
  if (ctx.abortSignal.aborted) return { status: 'aborted' }
  yield {
    type: 'delta_emitted',
    entryId: range.endEntryId,
    action: {
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
  }
  for (const row of series) {
    if (ctx.abortSignal.aborted) return { status: 'aborted' }
    yield {
      type: 'delta_emitted',
      entryId: range.endEntryId,
      action: {
        kind: 'stampEntryChapter',
        source: 'chapter_close',
        payload: { branchId: ctx.branchId, id: row.id, chapterId: range.chapterId },
      },
    }
  }
  return { status: 'completed' }
}
