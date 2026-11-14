import { asc, desc, eq, isNull } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { generateStructured } from '@/lib/ai'
import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import {
  branches,
  chapters,
  deltas,
  pipelineRuns,
  storyEntries,
  type Chapter,
  type Delta,
  type StoryEntry,
} from '@/lib/db'
import { configureDeltaActionPort, pipelineEventBus, recoverInFlightRuns } from '@/lib/pipeline'
import { expectRan, realDeltaActionPort, resetSingletons } from '@/lib/pipeline/__tests__/harness'
import {
  metadataReplyResult,
  openCloseFixture,
  type CloseFixture,
} from '@/lib/pipeline/definitions/__tests__/close-fixture'
import { __setCloseAgentSlots, NO_CLOSE_TASKS } from '@/lib/pipeline/definitions/close-agent/slots'
import { formatRecoveryReport } from '@/lib/recovery/copy'
import { generationStore, interruptMemoryRuns } from '@/lib/stores'
import { selectUndoTarget } from '@/lib/undo'

import { startManualClose } from './start-manual-close'
import { applyDeltaActionGroupWithOutcomes } from '../delta/apply-delta-action'
import { shownCounts } from '../story-entries/__tests__/shown-counts'
import { rollbackToEntry } from '../story-entries/operational'
import { redoLastAction, undoLastAction } from '../story-entries/undo'
import type { PipelineAction } from '../types'

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn<typeof generateStructured>(),
}))

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: generateStructuredMock,
}))

beforeEach(() => {
  resetSingletons()
  __setCloseAgentSlots(NO_CLOSE_TASKS)
  generateStructuredMock.mockReset()
  generateStructuredMock.mockResolvedValue(metadataReplyResult())
})

afterEach(() => {
  __setCloseAgentSlots(undefined)
  resetSingletons()
  vi.restoreAllMocks()
})

// The third of six replies: turns lie on both sides of the close.
const END_REPLY = 2

async function chapterRows(fx: CloseFixture): Promise<Chapter[]> {
  return fx.ctx.db.select().from(chapters).where(eq(chapters.branchId, fx.branchId))
}

async function entryRows(fx: CloseFixture): Promise<StoryEntry[]> {
  return fx.ctx.db
    .select()
    .from(storyEntries)
    .where(eq(storyEntries.branchId, fx.branchId))
    .orderBy(asc(storyEntries.position))
}

// Newest first, as selectUndoTarget reads the log.
async function logRows(fx: CloseFixture): Promise<Delta[]> {
  return (await fx.ctx.db
    .select()
    .from(deltas)
    .where(eq(deltas.branchId, fx.branchId))
    .orderBy(desc(deltas.logPosition))) as Delta[]
}

async function deltasOf(fx: CloseFixture, actionId: string): Promise<Delta[]> {
  return (await logRows(fx)).filter((d) => d.actionId === actionId)
}

async function processedThrough(fx: CloseFixture): Promise<number | null | undefined> {
  const [row] = await fx.ctx.db
    .select({ status: branches.classifierStatus })
    .from(branches)
    .where(eq(branches.id, fx.branchId))
  return row?.status?.processedThrough
}

function positionOf(fx: CloseFixture, entryId: string): number {
  const entry = fx.entries.find((e) => e.id === entryId)
  if (!entry) throw new Error(`no entry ${entryId} in the fixture`)
  return entry.position
}

function idsBefore(fx: CloseFixture, position: number): string[] {
  return fx.entries.filter((e) => e.position < position).map((e) => e.id)
}

// Acts on the close's group: the bus hears it once dispatched, so a landed group has committed.
function onGroup(act: () => void): PipelineAction['kind'][][] {
  const groups: PipelineAction['kind'][][] = []
  pipelineEventBus.subscribe('delta_group_emitted', (event) => {
    groups.push(event.actions.map((a) => a.kind))
    if (groups.length === 1) act()
  })
  return groups
}

// Every single write the run sent: the report's, which a write after the group would be.
function singleWrites(): PipelineAction['kind'][] {
  const kinds: PipelineAction['kind'][] = []
  pipelineEventBus.subscribe('delta_emitted', (event) => {
    kinds.push(event.action.kind)
  })
  return kinds
}

// The close's group: the create, then a stamp per entry through the end reply.
function closeKinds(fx: CloseFixture): PipelineAction['kind'][] {
  const stamps = idsBefore(fx, positionOf(fx, fx.replyIds[END_REPLY]) + 1).length
  return ['createChapter', ...Array.from({ length: stamps }, () => 'stampEntryChapter' as const)]
}

describe('reversing a close that ran', () => {
  it('takes the row, the report and every stamp in one CTRL-Z, then the turn; redo gives each back whole', async () => {
    const fx = await openCloseFixture()
    const end = fx.replyIds[END_REPLY]
    const tx = expectRan(await startManualClose(fx.branchId, end, fx.ctx))
    expect(tx.outcome).toBe('completed')
    const [closed] = await chapterRows(fx)
    const closedEntries = await entryRows(fx)
    const closedLog = await logRows(fx)
    const watermark = await processedThrough(fx)
    // Stamps to reverse: every entry through the end carries the chapter.
    expect(closedEntries.filter((e) => e.chapterId === closed.id).map((e) => e.id)).toEqual(
      idsBefore(fx, positionOf(fx, end) + 1),
    )

    expect(selectUndoTarget(closedLog)).toEqual({ actionId: tx.actionId, kind: 'group' })
    // The tick C5's hook refetches on, and where criterion 28's CTRL-Z bar ends.
    const settledBeforeUndo = generationStore.getSettleCount()
    expect(await undoLastAction(fx.branchId, fx.ctx)).toEqual({ status: 'ok' })
    expect(generationStore.getSettleCount()).toBeGreaterThan(settledBeforeUndo)

    expect(await chapterRows(fx)).toEqual([])
    expect(await entryRows(fx)).toEqual(closedEntries.map((e) => ({ ...e, chapterId: null })))
    expect(await deltasOf(fx, tx.actionId)).toEqual([])
    expect(await processedThrough(fx)).toBe(watermark)

    const turn = selectUndoTarget(await logRows(fx))
    expect(turn?.kind).toBe('turn')
    const turnStart = turn?.kind === 'turn' ? positionOf(fx, turn.entryId) : Number.NaN
    expect(await undoLastAction(fx.branchId, fx.ctx)).toEqual({ status: 'ok' })
    expect((await entryRows(fx)).map((e) => e.id)).toEqual(idsBefore(fx, turnStart))

    expect(await redoLastAction(fx.branchId, fx.ctx)).toEqual({ status: 'ok' })
    expect((await entryRows(fx)).map((e) => e.id)).toEqual(closedEntries.map((e) => e.id))
    expect(await chapterRows(fx)).toEqual([])
    expect((await entryRows(fx)).map((e) => e.chapterId)).toEqual(closedEntries.map(() => null))

    const settledBeforeRedo = generationStore.getSettleCount()
    expect(await redoLastAction(fx.branchId, fx.ctx)).toEqual({ status: 'ok' })
    expect(generationStore.getSettleCount()).toBeGreaterThan(settledBeforeRedo)
    expect(await chapterRows(fx)).toEqual([closed])
    expect(await entryRows(fx)).toEqual(closedEntries)
    expect(await logRows(fx)).toEqual(closedLog)
  })

  it('spares a close a rollback to the entry after its end', async () => {
    const fx = await openCloseFixture()
    const end = fx.replyIds[END_REPLY]
    const after = fx.entries[fx.entries.findIndex((e) => e.id === end) + 1]
    const before = await shownCounts(fx.branchId, after.id, fx.ctx)
    const tx = expectRan(await startManualClose(fx.branchId, end, fx.ctx))
    expect(tx.outcome).toBe('completed')
    const [closed] = await chapterRows(fx)
    const closeLog = await deltasOf(fx, tx.actionId)

    const counts = await shownCounts(fx.branchId, after.id, fx.ctx)
    expect(counts.chapters).toBe(0)
    expect(counts).toEqual(before)
    expect(
      await rollbackToEntry(fx.branchId, after.id, fx.ctx, { expectedCounts: counts }),
    ).toEqual({ status: 'ok', counts })

    expect(await chapterRows(fx)).toEqual([closed])
    const survivors = await entryRows(fx)
    expect(survivors.map((e) => e.id)).toEqual(idsBefore(fx, after.position))
    expect(survivors.map((e) => e.chapterId)).toEqual(survivors.map(() => closed.id))
    expect(await deltasOf(fx, tx.actionId)).toEqual(closeLog)
  })

  it.each([
    { name: 'the end entry', targetOf: (fx: CloseFixture) => fx.replyIds[END_REPLY] },
    {
      name: 'a reply inside the chapter',
      targetOf: (fx: CloseFixture) => fx.replyIds[END_REPLY - 1],
    },
  ])('takes all of a close in a rollback to $name', async ({ targetOf }) => {
    const fx = await openCloseFixture()
    const target = targetOf(fx)
    const targetPosition = positionOf(fx, target)
    const before = await shownCounts(fx.branchId, target, fx.ctx)
    const tx = expectRan(await startManualClose(fx.branchId, fx.replyIds[END_REPLY], fx.ctx))
    expect(tx.outcome).toBe('completed')

    // One chapter re-opened; its stamps add no entry, its report no world-state change. Its nine
    // writes (the create, a stamp for each of the seven entries through E, the report) all anchor
    // on E, so the window holds them.
    const counts = await shownCounts(fx.branchId, target, fx.ctx)
    expect(counts).toEqual({ ...before, chapters: 1, closeWrites: 9, reopenedChapter: 1 })
    expect(await rollbackToEntry(fx.branchId, target, fx.ctx, { expectedCounts: counts })).toEqual({
      status: 'ok',
      counts,
    })

    expect(await chapterRows(fx)).toEqual([])
    const survivors = await entryRows(fx)
    expect(survivors.map((e) => e.id)).toEqual(idsBefore(fx, targetPosition))
    expect(survivors.map((e) => e.chapterId)).toEqual(survivors.map(() => null))
    expect(await processedThrough(fx)).toBe(targetPosition - 1)
    expect(await deltasOf(fx, tx.actionId)).toEqual([])
  })

  it('leaves no stamp and no row when Cancel lands after the group, before the report', async () => {
    const fx = await openCloseFixture()
    const end = fx.replyIds[END_REPLY]
    const groups = onGroup(() => {
      void interruptMemoryRuns(fx.branchId)
    })
    const singles = singleWrites()

    const tx = expectRan(await startManualClose(fx.branchId, end, fx.ctx))

    expect(tx.outcome).toBe('aborted')
    expect(groups).toEqual([closeKinds(fx)])
    expect(singles).toEqual([])
    expect(await chapterRows(fx)).toEqual([])
    expect((await entryRows(fx)).map((e) => e.chapterId)).toEqual(fx.entries.map(() => null))
    expect(await deltasOf(fx, tx.actionId)).toEqual([])
    expect(generationStore.getTxState().deferred.get(fx.branchId)).toEqual({ close: true })
    expect(generationStore.getTxState().pendingClose.get(fx.branchId)).toEqual({
      endEntryId: end,
    })
  })

  it('leaves no stamp and no row when a rollback interrupts after the group, before the report', async () => {
    const fx = await openCloseFixture()
    // The last turn's action, past the end: alone, this rollback would spare a committed close.
    const target = fx.entries[fx.entries.length - 2]
    expect(target.kind).toBe('user_action')
    const shown = await shownCounts(fx.branchId, target.id, fx.ctx)
    let rollback: ReturnType<typeof rollbackToEntry> | undefined
    const groups = onGroup(() => {
      rollback = rollbackToEntry(fx.branchId, target.id, fx.ctx, { expectedCounts: shown })
    })
    const singles = singleWrites()

    const tx = expectRan(await startManualClose(fx.branchId, fx.replyIds[END_REPLY], fx.ctx))

    expect(await rollback).toEqual({ status: 'ok', counts: shown })
    expect(tx.outcome).toBe('aborted')
    expect(groups).toEqual([closeKinds(fx)])
    expect(singles).toEqual([])
    expect(await chapterRows(fx)).toEqual([])
    const survivors = await entryRows(fx)
    expect(survivors.map((e) => e.id)).toEqual(idsBefore(fx, target.position))
    expect(survivors.map((e) => e.chapterId)).toEqual(survivors.map(() => null))
    expect(await deltasOf(fx, tx.actionId)).toEqual([])
    expect(generationStore.getTxState().deferred.get(fx.branchId)).toEqual({ close: true })
  })

  it('reverses at boot a close a crash left after its group, with the close’s copy', async () => {
    const fx = await openCloseFixture()
    const stamps = idsBefore(fx, positionOf(fx, fx.replyIds[END_REPLY]) + 1).length
    let crash = (): void => {}
    const crashed = new Promise<void>((resolve) => {
      crash = resolve
    })
    // The process dies once the group commits: the marker stays open over the create and stamps.
    configureDeltaActionPort({
      ...realDeltaActionPort(),
      applyDeltaActionGroupWithOutcomes: async (actions, args, ctx) => {
        await applyDeltaActionGroupWithOutcomes(actions, args, ctx)
        crash()
        return new Promise<never>(() => {})
      },
    })
    void startManualClose(fx.branchId, fx.replyIds[END_REPLY], fx.ctx)
    await crashed

    const [marker] = await fx.ctx.db
      .select()
      .from(pipelineRuns)
      .where(isNull(pipelineRuns.finishedAt))
    expect(marker).toMatchObject({ kind: CHAPTER_CLOSE_KIND, storyId: fx.storyId })
    expect(await chapterRows(fx)).toHaveLength(1)
    expect((await entryRows(fx)).filter((e) => e.chapterId !== null)).toHaveLength(stamps)

    // A restart: memory gone, the real port back.
    resetSingletons()
    const report = await recoverInFlightRuns(fx.ctx)

    expect(report).toEqual({
      reversed: [
        {
          runId: marker.runId,
          kind: CHAPTER_CLOSE_KIND,
          actionId: marker.actionId,
          storyId: fx.storyId,
          deltas: stamps + 1,
        },
      ],
      failures: [],
    })
    expect(await chapterRows(fx)).toEqual([])
    expect((await entryRows(fx)).map((e) => e.chapterId)).toEqual(fx.entries.map(() => null))
    expect(await deltasOf(fx, marker.actionId)).toEqual([])
    const [settled] = await fx.ctx.db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.runId, marker.runId))
    expect(settled.outcome).toBe('recovered')
    expect(settled.finishedAt).not.toBeNull()
    expect(
      formatRecoveryReport({ ...report, heldStoryIds: [] }, { [fx.storyId]: 'The Crossing' }),
    ).toBe(
      'An interrupted shutdown was detected in The Crossing. The chapter-close pass was reverted; your story content is intact.',
    )
  })
})
