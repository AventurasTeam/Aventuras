import { eq, sql } from 'drizzle-orm'

import { CHAPTER_CLOSE_KIND, fallbackChapterEnd } from '@/lib/chapters'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { chapters, openRegionSeries } from '@/lib/db'
import {
  emitDeltaGroup,
  PER_TURN_KIND,
  registerPipeline,
  type PhaseContext,
  type PhaseEmittedEvent,
  type PhaseResult,
} from '@/lib/pipeline'
import { generationStore } from '@/lib/stores'

import type { GroupOutcome, PipelineAction } from '../../types'

/** One run of the stand-in close, holding once its row and stamps committed as one group. */
export type HeldClose = {
  readonly actionId: string
  readonly beforeTurn: boolean
  /** `completed` ends the run over what it wrote; `failed` fails the phase, reversing the group. */
  finish: (outcome: 'completed' | 'failed') => void
}

export type StandInClose = {
  /** The next run once its group has committed and it holds; runs already holding come first. */
  nextHeld: () => Promise<HeldClose>
  /** Every run that reached its hold, in order. */
  readonly runs: readonly HeldClose[]
}

/**
 * Interruptible hard-gate close pipeline ending on the branch's pick, else `fallbackChapterEnd`.
 * Before its hold it writes its row and a stamp per entry through the end as one group anchored on
 * that end (C1), or the row alone under `leaveOpen`; a pick outside the open region fails it first.
 * Register before `ensureChapterClosePipelineRegistered`, which only fills a missing kind.
 */
export function registerStandInClose(options?: { leaveOpen?: true }): StandInClose {
  const runs: HeldClose[] = []
  const ready: HeldClose[] = []
  const waiting: ((run: HeldClose) => void)[] = []

  async function* phase(
    ctx: PhaseContext,
  ): AsyncGenerator<PhaseEmittedEvent, PhaseResult, GroupOutcome | undefined> {
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
    const create: PipelineAction = {
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
    }
    const stamps = options?.leaveOpen
      ? []
      : through.map(
          (row): PipelineAction => ({
            kind: 'stampEntryChapter',
            source: 'chapter_close',
            payload: { branchId: ctx.branchId, id: row.id, chapterId },
          }),
        )
    const written = yield* emitDeltaGroup([create, ...stamps], end.id)
    if (written.status === 'rejected' || written.outcomes.some((o) => o.status !== 'landed'))
      return {
        status: 'failed',
        error: { kind: 'action-layer', detail: 'stand-in close: group not applied' },
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
