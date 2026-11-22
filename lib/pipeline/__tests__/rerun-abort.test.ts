import { asc } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { CHAPTER_DELETE_REFUSAL } from '@/lib/actions/chapters/chapter-delete-set'
import { getCloseRerunPreview, startCloseRerun } from '@/lib/actions/chapters/close-rerun'
import { removeChapter } from '@/lib/actions/chapters/remove-chapter'
import { startManualClose } from '@/lib/actions/chapters/start-manual-close'
import { DeltaReplayError } from '@/lib/actions/delta/replay-errors'
import { shownCounts } from '@/lib/actions/story-entries/__tests__/shown-counts'
import { rollbackToEntry, updateStoryEntryContent } from '@/lib/actions/story-entries/operational'
import { STORY_ENTRY_REJECTION } from '@/lib/actions/story-entries/register'
import { redoLastAction, undoLastAction } from '@/lib/actions/story-entries/undo'
import { regenerateTurn } from '@/lib/actions/turns/regenerate-turn'
import { submitTurn } from '@/lib/actions/turns/submit-turn'
import type { generateStructured, generateToolStep } from '@/lib/ai'
import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import { reversalJournals, storyEntries, type Delta } from '@/lib/db'
import {
  CLOSE_PHASE,
  configureDeltaActionPort,
  pipelineEventBus,
  recoverInFlightRuns,
  type PipelineEvent,
} from '@/lib/pipeline'
import {
  currentStoryStore,
  entriesStore,
  generationStore,
  interruptMemoryRuns,
  RERUN_HELD,
} from '@/lib/stores'

import {
  branchLog,
  closedChapterId,
  defined,
  installCloseHarnessHooks,
  openHarness,
  recordGroups,
  rerunMarker,
  STAND_IN_STEP,
  worldState,
  type CloseCase,
  type CloseHarness,
  type CloseMocks,
  type ScriptedStep,
  type WorldState,
} from './close-harness'
import { standInSlots } from './close-stand-in'
import { realDeltaActionPort, within } from './harness'
import { writeTurnEntry } from '../definitions/__tests__/close-fixture'

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

// The close writes a lore row and Tobin's description; a re-run reverses them and writes them again.
const STAND_IN: CloseCase = { slots: standInSlots, steps: [STAND_IN_STEP], merge: false }

const NETWORK_FAILURE: ScriptedStep = {
  calls: [],
  failed: { tier: 'provider', reason: 'network', detail: 'connect ECONNREFUSED' },
}

type Closed = { h: CloseHarness; chapterId: string; log: Delta[] }

async function closed(c: CloseCase = STAND_IN): Promise<Closed> {
  const h = await openHarness(c, MOCKS)
  await h.close()
  return { h, chapterId: closedChapterId(h), log: await branchLog(h.fx) }
}

// Armed after the close: a close runs the same phases.
function interruptOnce(phase: string, branchId: string): void {
  const off = pipelineEventBus.subscribe('phase_complete', (event) => {
    if (event.name !== phase) return
    off()
    void interruptMemoryRuns(branchId)
  })
}

function recordDeferred(): PipelineEvent[] {
  const seen: PipelineEvent[] = []
  pipelineEventBus.subscribe('run_deferred', (event) => seen.push(event))
  return seen
}

// AC 9: the close as it stood before the re-run, its log positions included.
async function expectCloseAsItWas({ h, log }: Closed): Promise<void> {
  expect(await worldState(h.fx)).toEqual(h.closed().state)
  expect(await branchLog(h.fx)).toEqual(log)
  expect(await h.fx.ctx.db.select().from(reversalJournals)).toEqual([])
  expect(generationStore.getTxState().pendingRerun.has(h.fx.branchId)).toBe(false)
  expect(generationStore.getTxState().deferred.has(h.fx.branchId)).toBe(false)
}

describe('a re-run that stops (AC 9)', () => {
  it('restores the close when aborted after its reversal, before any write of its own', async () => {
    const c = await closed()
    const deferred = recordDeferred()
    const groups = recordGroups()
    interruptOnce(CLOSE_PHASE.reversal, c.h.fx.branchId)

    const end = await within(c.h.rerun(c.chapterId), 'the re-run')

    expect(end).toMatchObject({ kind: CHAPTER_CLOSE_KIND, result: { outcome: 'aborted' } })
    expect(end.result).not.toHaveProperty('closeUndone')
    expect(groups, 'the re-run dispatched no group').toEqual([])
    await expectCloseAsItWas(c)
    // The reversal committed: its transaction wrote the marker's column.
    expect(await rerunMarker(c.h)).toMatchObject({
      outcome: 'aborted',
      rerunChapterId: c.chapterId,
    })
    expect(deferred).toEqual([])
  })

  it('restores the close when aborted after its first write', async () => {
    const c = await closed()
    const deferred = recordDeferred()
    c.h.onNextToolGroup(() => {
      void interruptMemoryRuns(c.h.fx.branchId)
    })

    const end = await within(c.h.rerun(c.chapterId), 'the re-run')

    expect(c.h.actedOn()).toEqual({ kinds: ['createLore', 'updateEntity'], landed: true })
    expect(end).toMatchObject({ kind: CHAPTER_CLOSE_KIND, result: { outcome: 'aborted' } })
    expect(end.result).not.toHaveProperty('closeUndone')
    await expectCloseAsItWas(c)
    expect(await rerunMarker(c.h)).toMatchObject({ outcome: 'aborted' })
    expect(deferred).toEqual([])
  })

  it('restores the close when a tool step fails after its first write, and reports the failure', async () => {
    const c = await closed({ ...STAND_IN, rerunSteps: [STAND_IN_STEP, NETWORK_FAILURE] })
    const deferred = recordDeferred()
    // Fires on a landed group only: a refused first group leaves it unset.
    c.h.onNextToolGroup(() => {})
    const rerunGroups = recordGroups()

    const end = await within(c.h.rerun(c.chapterId), 'the re-run')

    expect(rerunGroups).toEqual([['createLore', 'updateEntity']])
    expect(c.h.actedOn(), "the re-run's first group landed").toEqual({
      kinds: ['createLore', 'updateEntity'],
      landed: true,
    })
    expect(end).toMatchObject({
      kind: CHAPTER_CLOSE_KIND,
      result: { outcome: 'failed', error: { kind: 'provider', reason: 'network' } },
    })
    expect(end.result).not.toHaveProperty('closeUndone')
    await expectCloseAsItWas(c)
    expect(await rerunMarker(c.h)).toMatchObject({ outcome: 'failed' })
    expect(deferred).toEqual([])
  })

  it('writes nothing and finds no journal when aborted before its reversal', async () => {
    const c = await closed()
    const deferred = recordDeferred()
    interruptOnce(CLOSE_PHASE.metadata, c.h.fx.branchId)

    const end = await within(c.h.rerun(c.chapterId), 'the re-run')

    expect(end).toMatchObject({ kind: CHAPTER_CLOSE_KIND, result: { outcome: 'aborted' } })
    await expectCloseAsItWas(c)
    expect(await rerunMarker(c.h)).toMatchObject({ outcome: 'aborted', rerunChapterId: null })
    expect(deferred).toEqual([])
  })
})

// generation-pipeline.md → Recovery-failure policy: a re-run's Cancel whose reversal didn't commit
// leaves its writes, its journal and its open marker for boot recovery, and the branch holds every
// write until the restart that runs it.
describe("a re-run whose Cancel couldn't take itself back", () => {
  const failReversals = (): void =>
    configureDeltaActionPort({
      ...realDeltaActionPort(),
      reverseRunGroup: ({ actionId }) =>
        Promise.reject(
          new DeltaReplayError('Reverse-replay failed', {
            cause: new Error('disk I/O error'),
            actionId,
            stage: 'transaction',
          }),
        ),
    })

  type Left = Awaited<ReturnType<typeof leftBehind>>

  async function leftBehind(h: CloseHarness) {
    const { db } = h.fx.ctx
    return {
      world: await worldState(h.fx),
      log: await branchLog(h.fx),
      entries: await db
        .select({ id: storyEntries.id, content: storyEntries.content })
        .from(storyEntries)
        .orderBy(asc(storyEntries.position)),
      journals: await db.select().from(reversalJournals),
      marker: await rerunMarker(h),
    }
  }

  // A turn after the close, so a re-run's start has turns to roll back first.
  async function turnSince({ h }: Closed): Promise<void> {
    const position = defined(h.fx.entries.at(-1), 'the fixture has no entry').position + 1
    await writeTurnEntry(h.fx, 'act_turn_since', {
      id: `entry_since_${position}`,
      position,
      kind: 'user_action',
      content: 'I ask the ferryman for the night crossing.',
    })
    await writeTurnEntry(h.fx, 'act_turn_since', {
      id: `entry_since_${position + 1}`,
      position: position + 1,
      kind: 'ai_reply',
      content: 'Tobin names his price and pushes off.',
    })
  }

  async function heldAfterFailedCancel(): Promise<
    Closed & { left: Left; beforeRerun: { world: WorldState; log: Delta[] } }
  > {
    const c = await closed()
    await turnSince(c)
    const beforeRerun = { world: await worldState(c.h.fx), log: await branchLog(c.h.fx) }
    c.h.onNextToolGroup(() => {
      failReversals()
      void interruptMemoryRuns(c.h.fx.branchId)
    })
    const end = await within(c.h.rerun(c.chapterId), 'the re-run')
    expect(end.result).toMatchObject({ outcome: 'failed', unreversed: true })
    configureDeltaActionPort(realDeltaActionPort())
    const left = await leftBehind(c.h)
    expect(left.journals, 'the journal waits for boot').toHaveLength(1)
    expect(left.marker).toMatchObject({ finishedAt: null, rerunChapterId: c.chapterId })
    return { ...c, left, beforeRerun }
  }

  it.each<[string, (c: Closed) => Promise<unknown>, unknown]>([
    [
      'CTRL-Z',
      (c) => undoLastAction(c.h.fx.branchId, c.h.fx.ctx),
      { status: 'rejected', code: 'gated' },
    ],
    [
      'redo',
      (c) => redoLastAction(c.h.fx.branchId, c.h.fx.ctx),
      { status: 'rejected', code: 'gated' },
    ],
    [
      'a later close',
      (c) => startManualClose(c.h.fx.branchId, c.h.fx.replyIds[4]!, c.h.fx.ctx),
      { outcome: 'rejected', blockedBy: RERUN_HELD },
    ],
    [
      "the chapter's whole delete",
      (c) => removeChapter(c.h.fx.branchId, c.chapterId, 'whole', c.h.fx.ctx),
      { status: 'rejected', code: CHAPTER_DELETE_REFUSAL.inFlight },
    ],
    [
      'another re-run, with turns to roll back',
      async (c) => {
        const { branchId, ctx } = c.h.fx
        const open = currentStoryStore.getCurrentStory()!
        const preview = await getCloseRerunPreview(branchId, c.chapterId, open, ctx)
        if ('status' in preview) throw new Error(`preview refused: ${preview.code}`)
        expect(preview.shortcut, 'the re-run would roll back the turns').not.toBeNull()
        const { targetEntryId, counts } = preview.shortcut!
        return startCloseRerun(
          branchId,
          c.chapterId,
          { shortcut: { targetEntryId, counts }, reversal: preview.reversal },
          ctx,
        )
      },
      { outcome: 'rejected', blockedBy: RERUN_HELD },
    ],
    [
      'a rollback',
      async (c) => {
        const { branchId, ctx, replyIds } = c.h.fx
        const expectedCounts = await shownCounts(branchId, replyIds[3]!, ctx)
        return rollbackToEntry(branchId, replyIds[3]!, ctx, { expectedCounts })
      },
      { status: 'rejected', code: STORY_ENTRY_REJECTION.inFlight },
    ],
    [
      'an entry edit',
      (c) => updateStoryEntryContent(c.h.fx.branchId, c.h.fx.replyIds[5]!, 'Edited.', c.h.fx.ctx),
      { status: 'rejected', code: STORY_ENTRY_REJECTION.inFlight },
    ],
    [
      'a regenerate',
      (c) =>
        regenerateTurn(
          { storyId: c.h.fx.storyId, branchId: c.h.fx.branchId },
          c.h.fx.replyIds[5]!,
          c.h.fx.ctx,
          { expectedCounts: undefined },
        ),
      { status: 'rejected', code: 'generation-in-flight' },
    ],
  ])('refuses %s, writing nothing', async (_label, act, refusal) => {
    const c = await heldAfterFailedCancel()

    expect(await within(act(c), 'the refusal')).toMatchObject(refusal as object)
    expect(await leftBehind(c.h)).toEqual(c.left)
  })

  it('refuses a Send before its turn shows', async () => {
    const c = await heldAfterFailedCancel()
    const { branchId, storyId, ctx } = c.h.fx
    let shown = false
    const off = entriesStore.subscribe(() => {
      if (entriesStore.getEntries().size !== c.left.entries.length) shown = true
    })
    try {
      expect(
        await submitTurn({ storyId, branchId }, { content: 'I wave.', composerMode: 'free' }, ctx),
      ).toEqual({ outcome: 'rejected', blockedBy: RERUN_HELD, converged: true })
    } finally {
      off()
    }
    expect(shown, 'the turn showed and was taken back').toBe(false)
    expect(await leftBehind(c.h)).toEqual(c.left)
  })

  it('refuses a rollback that interrupted the re-run, once its Cancel failed', async () => {
    const c = await closed()
    const { branchId, ctx, replyIds } = c.h.fx
    // An open-region rollback spares the chapter, so it interrupts the re-run rather than wait.
    const expectedCounts = await shownCounts(branchId, replyIds[4]!, ctx)
    let rollback: Promise<unknown> | undefined
    c.h.onNextToolGroup(() => {
      failReversals()
      rollback = rollbackToEntry(branchId, replyIds[4]!, ctx, { expectedCounts })
    })

    await within(c.h.rerun(c.chapterId), 'the re-run')
    configureDeltaActionPort(realDeltaActionPort())

    expect(await within(defined(rollback, 'the rollback'), 'the rollback')).toMatchObject({
      status: 'rejected',
      code: STORY_ENTRY_REJECTION.inFlight,
    })
    const entries = await ctx.db.select({ id: storyEntries.id }).from(storyEntries)
    expect(entries.map((e) => e.id)).toContain(replyIds[5])
  })

  it('a restart drops the hold, and boot recovery restores the close', async () => {
    const c = await heldAfterFailedCancel()

    generationStore.__reset()
    expect(generationStore.isUserEditBlocked()).toBe(false)
    const report = await recoverInFlightRuns(c.h.fx.ctx)

    expect(report.failures).toEqual([])
    expect(await worldState(c.h.fx)).toEqual(c.beforeRerun.world)
    expect(await branchLog(c.h.fx)).toEqual(c.beforeRerun.log)
    expect(await c.h.fx.ctx.db.select().from(reversalJournals)).toEqual([])
  })
})
