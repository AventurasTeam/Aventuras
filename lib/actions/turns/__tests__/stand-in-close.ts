import { eq, sql } from 'drizzle-orm'

import { CHAPTER_CLOSE_KIND, fallbackChapterEnd } from '@/lib/chapters'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { chapters, openRegionSeries } from '@/lib/db'
import {
  PER_TURN_KIND,
  registerPipeline,
  type PhaseContext,
  type PhaseEmittedEvent,
  type PhaseResult,
} from '@/lib/pipeline'
import { generationStore } from '@/lib/stores'

/** One run of the stand-in close, holding after it wrote its chapter row. */
export type HeldClose = {
  readonly actionId: string
  readonly beforeTurn: boolean
  /**
   * `completed` stamps the region through the end like the real metadata phase, unless `leaveOpen`;
   * `failed` fails the phase, reversing the row.
   */
  finish: (outcome: 'completed' | 'failed') => void
}

export type StandInClose = {
  /** The next run once its row has committed and it holds; runs already holding come first. */
  nextHeld: () => Promise<HeldClose>
  /** Every run that reached its hold, in order. */
  readonly runs: readonly HeldClose[]
}

/**
 * Interruptible hard-gate close pipeline ending on the branch's pick, else `fallbackChapterEnd`,
 * writes anchored on that end (C1); a pick outside the open region fails the run first.
 * Register before `ensureChapterClosePipelineRegistered`, which only fills a missing kind.
 */
export function registerStandInClose(options?: { leaveOpen?: true }): StandInClose {
  const runs: HeldClose[] = []
  const ready: HeldClose[] = []
  const waiting: ((run: HeldClose) => void)[] = []

  async function* phase(ctx: PhaseContext): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
    if (ctx.abortSignal.aborted) return { status: 'aborted' }
    const series = await openRegionSeries(ctx.branchId, ctx)
    const pick = generationStore.getTxState().pendingClose.get(ctx.branchId)
    const end = pick
      ? (series.find((row) => row.id === pick.endEntryId) ?? null)
      : fallbackChapterEnd(series)
    if (end == null)
      return {
        status: 'failed',
        error: { kind: 'phase-logic', detail: 'stand-in close: no end entry' },
      }
    const through = series.slice(0, series.indexOf(end) + 1)
    const chapterId = `chap_${ctx.actionId}`
    const [count] = await ctx.db
      .select({ n: sql<number>`COUNT(*)` })
      .from(chapters)
      .where(eq(chapters.branchId, ctx.branchId))
    const now = Date.now()
    yield {
      type: 'delta_emitted',
      entryId: end.id,
      action: {
        kind: 'createChapter',
        source: 'chapter_close',
        payload: {
          entry: {
            id: chapterId,
            branchId: ctx.branchId,
            sequenceNumber: (count?.n ?? 0) + 1,
            title: 'Stand-in chapter',
            summary: 'Closed by the stand-in close.',
            theme: 'a stand-in',
            keywords: [],
            startEntryId: through[0].id,
            endEntryId: end.id,
            tokenCount: through.reduce((sum, row) => sum + row.tokens, 0),
            closedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        },
      },
    }
    const beforeTurn = [...generationStore.getTxState().runs.values()].some(
      (r) => r.actionId === ctx.actionId && r.beforeTurn,
    )
    const outcome = await new Promise<'completed' | 'failed' | 'aborted'>((resolve) => {
      if (ctx.abortSignal.aborted) {
        resolve('aborted')
        return
      }
      ctx.abortSignal.addEventListener('abort', () => resolve('aborted'), { once: true })
      const run: HeldClose = { actionId: ctx.actionId, beforeTurn, finish: resolve }
      runs.push(run)
      const waiter = waiting.shift()
      if (waiter) waiter(run)
      else ready.push(run)
    })
    if (outcome === 'aborted') return { status: 'aborted' }
    if (outcome === 'failed')
      return { status: 'failed', error: { kind: 'phase-logic', detail: 'stand-in close failed' } }
    if (options?.leaveOpen) return { status: 'completed' }
    for (const row of through) {
      if (ctx.abortSignal.aborted) return { status: 'aborted' }
      yield {
        type: 'delta_emitted',
        entryId: end.id,
        action: {
          kind: 'stampEntryChapter',
          source: 'chapter_close',
          payload: { branchId: ctx.branchId, id: row.id, chapterId },
        },
      }
    }
    return { status: 'completed' }
  }

  // Mirrors the real close's gate, deferral slot and blockedBy (chapter-close.ts).
  registerPipeline({
    kind: CHAPTER_CLOSE_KIND,
    phases: [{ name: 'metadata', run: phase }],
    affordance: 'pill-and-banner',
    gateBehavior: 'hard-gate',
    interruptible: 'close',
    concurrencyPolicy: {
      blockedBy: [PER_TURN_KIND, PERIODIC_CLASSIFIER_KIND, CHAPTER_CLOSE_KIND, 'translation-retry'],
    },
  })

  return {
    runs,
    nextHeld: () => {
      const run = ready.shift()
      return run ? Promise.resolve(run) : new Promise((resolve) => waiting.push(resolve))
    },
  }
}
