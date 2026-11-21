import { and, eq, gt } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { shownCounts } from '@/lib/actions/story-entries/__tests__/shown-counts'
import { rollbackToEntry } from '@/lib/actions/story-entries/operational'
import { regenerateTurn } from '@/lib/actions/turns/regenerate-turn'
import type { generateStructured, generateToolStep } from '@/lib/ai'
import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import { reversalJournals, storyEntries, type Delta } from '@/lib/db'
import { generationStore } from '@/lib/stores'

import {
  branchLog,
  closedChapterId,
  deltasOf,
  installCloseHarnessHooks,
  openHarness,
  STAND_IN_STEP,
  stepHold,
  worldState,
  type CloseHarness,
  type CloseMocks,
  type StepHold,
} from './close-harness'
import { standInSlots } from './close-stand-in'
import { within } from './harness'

const { generateStructuredMock, generateToolStepMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn<typeof generateStructured>(),
  generateToolStepMock: vi.fn<typeof generateToolStep>(),
}))

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: generateStructuredMock,
  generateToolStep: generateToolStepMock,
}))

const MOCKS: CloseMocks = {
  generateStructured: generateStructuredMock,
  generateToolStep: generateToolStepMock,
}

installCloseHarnessHooks(MOCKS)

type Held = {
  h: CloseHarness
  hold: StepHold
  ending: ReturnType<CloseHarness['rerun']>
  log: Delta[]
}

// A re-run whose reversal committed, held at its first tool step.
async function heldRerun(before?: (h: CloseHarness) => Promise<void>): Promise<Held> {
  const hold = stepHold()
  const h = await openHarness(
    {
      slots: standInSlots,
      steps: [STAND_IN_STEP],
      rerunSteps: [{ ...STAND_IN_STEP, held: hold }],
      merge: false,
    },
    MOCKS,
  )
  await before?.(h)
  await h.close()
  const ending = h.rerun(closedChapterId(h))
  await within(hold.reached, "the re-run's first tool step")
  return { h, hold, ending, log: await branchLog(h.fx) }
}

const rerunRunning = (h: CloseHarness): boolean =>
  [...generationStore.getTxState().runs.values()].some(
    (run) => run.branchId === h.fx.branchId && run.interruptible === 'rerun',
  )

const afterEnd = (h: CloseHarness) =>
  h.fx.entries[h.fx.entries.findIndex((entry) => entry.id === h.endEntryId) + 1]!

describe('head reversals during a re-run (AC 23)', () => {
  it('holds a rollback into the chapter, the re-run running and the log as it was', async () => {
    const { h, hold, ending, log } = await heldRerun()
    const stamped = h.fx.entries[1]!.id
    const counts = await shownCounts(h.fx.branchId, stamped, h.fx.ctx)

    const result = await rollbackToEntry(h.fx.branchId, stamped, h.fx.ctx, {
      expectedCounts: counts,
    })

    expect(result).toEqual({
      status: 'rejected',
      reason: 'generation in flight',
      code: 'in-flight-gated',
    })
    expect(rerunRunning(h)).toBe(true)
    expect(await branchLog(h.fx)).toEqual(log)
    hold.release()
    expect(await within(ending, 'the re-run')).toMatchObject({
      kind: CHAPTER_CLOSE_KIND,
      result: { outcome: 'completed' },
    })
  })

  it('refuses a rollback to a missing entry as not-found, the re-run running and the log as it was', async () => {
    const { h, hold, ending, log } = await heldRerun()
    const counts = await shownCounts(h.fx.branchId, h.fx.entries[1]!.id, h.fx.ctx)

    const result = await rollbackToEntry(h.fx.branchId, 'entry_gone', h.fx.ctx, {
      expectedCounts: counts,
    })

    expect(result).toEqual({
      status: 'rejected',
      reason: `target ${h.fx.branchId}:entry_gone not found`,
      code: 'not-found',
    })
    expect(rerunRunning(h)).toBe(true)
    expect(await branchLog(h.fx)).toEqual(log)
    hold.release()
    expect(await within(ending, 'the re-run')).toMatchObject({
      kind: CHAPTER_CLOSE_KIND,
      result: { outcome: 'completed' },
    })
  })

  it('holds a regenerate of the end reply after a manual close on the latest reply', async () => {
    // Rolled back past E first, so the close ends on the latest reply.
    const { h, hold, ending, log } = await heldRerun((h) => h.rollBack(afterEnd(h).id))
    const counts = await shownCounts(h.fx.branchId, h.endEntryId, h.fx.ctx)

    const result = await regenerateTurn(
      { storyId: h.fx.storyId, branchId: h.fx.branchId },
      h.endEntryId,
      h.fx.ctx,
      { expectedCounts: counts },
    )

    expect(result).toEqual({
      status: 'rejected',
      code: 'generation-in-flight',
      reason: 'generation in flight',
    })
    expect(rerunRunning(h)).toBe(true)
    expect(await branchLog(h.fx)).toEqual(log)
    hold.release()
    expect(await within(ending, 'the re-run')).toMatchObject({
      result: { outcome: 'completed' },
    })
  })

  it('lets a rollback that spares the chapter interrupt the re-run, whose abort restores the close, then land', async () => {
    const { h, ending } = await heldRerun()
    const target = afterEnd(h)
    const counts = await shownCounts(h.fx.branchId, target.id, h.fx.ctx)

    const result = await rollbackToEntry(h.fx.branchId, target.id, h.fx.ctx, {
      expectedCounts: counts,
    })

    expect(result).toEqual({ status: 'ok', counts })
    const end = await within(ending, 'the re-run')
    expect(end).toMatchObject({ kind: CHAPTER_CLOSE_KIND, result: { outcome: 'aborted' } })
    expect(end.result).not.toHaveProperty('closeUndone')
    expect(await worldState(h.fx)).toEqual(h.closed().state)
    expect(await deltasOf(h.fx, h.actionId())).toEqual(h.closed().log)
    expect(await h.fx.ctx.db.select().from(reversalJournals)).toEqual([])
    expect(
      await h.fx.ctx.db
        .select({ id: storyEntries.id })
        .from(storyEntries)
        .where(
          and(
            eq(storyEntries.branchId, h.fx.branchId),
            gt(storyEntries.position, target.position - 1),
          ),
        ),
    ).toEqual([])
  })
})
