import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { undoLastAction } from '@/lib/actions/story-entries/undo'
import { recordDeferrals, registerStandInPass } from '@/lib/actions/turns/__tests__/stand-in-pass'
import type { generateStructured, generateToolStep } from '@/lib/ai'
import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { branches } from '@/lib/db'
import { pipelineEventBus, type PipelineEvent } from '@/lib/pipeline'
import { generationStore, interruptMemoryRuns, type RunState } from '@/lib/stores'

import {
  branchLog,
  closedChapterId,
  installCloseHarnessHooks,
  openHarness,
  STAND_IN_STEP,
  stepHold,
  type CloseCase,
  type CloseHarness,
  type CloseMocks,
} from './close-harness'
import { standInSlots } from './close-stand-in'
import { within } from './harness'
import { setClassifierStatus } from '../definitions/__tests__/close-fixture'

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

const STAND_IN: CloseCase = { slots: standInSlots, steps: [STAND_IN_STEP], merge: false }

type Started = { kind: string; slot: RunState['interruptible'] | undefined; actionId: string }

// The slot each run reserved in, read as it starts.
function recordStarts(): Started[] {
  const seen: Started[] = []
  pipelineEventBus.subscribe('run_start', (event) => {
    seen.push({
      kind: event.kind,
      slot: generationStore.getTxState().runs.get(event.runId)?.interruptible,
      actionId: event.actionId,
    })
  })
  return seen
}

type RunComplete = Extract<PipelineEvent, { type: 'run_complete' }>

function recordCompletes(): RunComplete[] {
  const seen: RunComplete[] = []
  pipelineEventBus.subscribe('run_complete', (event) => seen.push(event))
  return seen
}

const endPosition = (h: CloseHarness): number =>
  h.fx.entries.find((entry) => entry.id === h.endEntryId)!.position

async function processedThrough(h: CloseHarness): Promise<number | null | undefined> {
  const [row] = await h.fx.ctx.db
    .select({ status: branches.classifierStatus })
    .from(branches)
    .where(eq(branches.id, h.fx.branchId))
  return row?.status?.processedThrough
}

const pendingRerunOn = (h: CloseHarness): boolean =>
  generationStore.getTxState().pendingRerun.has(h.fx.branchId)

describe('the re-run chain (AC 15)', () => {
  it('runs the re-run alone, in its own slot, when only entries past E are unprocessed, and chains nothing', async () => {
    const h = await openHarness(STAND_IN, MOCKS)
    const completes = recordCompletes()
    await h.close()
    await setClassifierStatus(h.fx, { state: 'idle', processedThrough: endPosition(h) })
    const starts = recordStarts()

    const end = await within(h.rerun(closedChapterId(h)), 'the re-run')

    const rerunAction = h.rerunActionId()
    expect(rerunAction).toEqual(expect.any(String))
    expect(starts).toEqual([{ kind: CHAPTER_CLOSE_KIND, slot: 'rerun', actionId: rerunAction }])
    expect(end).toMatchObject({
      kind: CHAPTER_CLOSE_KIND,
      result: { outcome: 'completed', actionId: rerunAction },
      cancelled: false,
    })
    expect(completes).toHaveLength(2)
    expect(completes[0]).toMatchObject({ kind: CHAPTER_CLOSE_KIND, actionId: h.actionId() })
    expect(completes[0]).not.toHaveProperty('rerun')
    expect(completes[1]).toMatchObject({
      kind: CHAPTER_CLOSE_KIND,
      actionId: rerunAction,
      outcome: 'completed',
      rerun: true,
    })
    // Nothing after the re-run read the entries past E.
    expect(await processedThrough(h)).toBe(endPosition(h))
    expect(pendingRerunOn(h)).toBe(false)
  })

  it('runs a catch-up pass first while an entry through E is unprocessed, then the re-run', async () => {
    const pass = registerStandInPass({ anchorEntryId: null })
    const h = await openHarness(STAND_IN, MOCKS)
    await h.close()
    await setClassifierStatus(h.fx, { state: 'idle', processedThrough: endPosition(h) - 1 })
    const starts = recordStarts()

    const ending = h.rerun(closedChapterId(h))
    const held = await within(pass.nextHeld(), 'the catch-up pass')

    expect(starts).toEqual([
      { kind: PERIODIC_CLASSIFIER_KIND, slot: 'pass', actionId: held.actionId },
    ])
    expect(pendingRerunOn(h)).toBe(true)
    held.finish('completed')
    const end = await within(ending, 'the re-run chain')

    expect(starts).toEqual([
      { kind: PERIODIC_CLASSIFIER_KIND, slot: 'pass', actionId: held.actionId },
      { kind: CHAPTER_CLOSE_KIND, slot: 'rerun', actionId: h.rerunActionId() },
    ])
    expect(end).toMatchObject({ kind: CHAPTER_CLOSE_KIND, result: { outcome: 'completed' } })
    expect(pendingRerunOn(h)).toBe(false)
  })

  it('ends with a catch-up pass that fails, starting no re-run and clearing the record', async () => {
    const pass = registerStandInPass({ anchorEntryId: null })
    const h = await openHarness(STAND_IN, MOCKS)
    await h.close()
    await setClassifierStatus(h.fx, { state: 'idle', processedThrough: endPosition(h) - 1 })
    const starts = recordStarts()

    const ending = h.rerun(closedChapterId(h))
    const held = await within(pass.nextHeld(), 'the catch-up pass')
    held.finish('failed')
    const end = await within(ending, 'the re-run chain')

    expect(end).toMatchObject({ kind: PERIODIC_CLASSIFIER_KIND, result: { outcome: 'failed' } })
    expect(starts.map((s) => s.kind)).toEqual([PERIODIC_CLASSIFIER_KIND])
    expect(h.rerunActionId()).toBeUndefined()
    expect(pendingRerunOn(h)).toBe(false)
  })

  it('defers a cancelled catch-up pass as any pass, clearing the record', async () => {
    const pass = registerStandInPass({ anchorEntryId: null })
    const h = await openHarness(STAND_IN, MOCKS)
    await h.close()
    await setClassifierStatus(h.fx, { state: 'idle', processedThrough: endPosition(h) - 1 })
    const deferrals = recordDeferrals()

    const ending = h.rerun(closedChapterId(h))
    await within(pass.nextHeld(), 'the catch-up pass')
    await interruptMemoryRuns(h.fx.branchId)
    const end = await within(ending, 'the re-run chain')

    expect(end).toMatchObject({ kind: PERIODIC_CLASSIFIER_KIND, result: { outcome: 'aborted' } })
    expect(generationStore.getTxState().deferred.get(h.fx.branchId)).toEqual({ pass: true })
    expect(deferrals).toMatchObject([
      { type: 'run_deferred', kind: PERIODIC_CLASSIFIER_KIND, work: 'pass' },
    ])
    expect(h.rerunActionId()).toBeUndefined()
    expect(pendingRerunOn(h)).toBe(false)
  })
})

describe('CTRL-Z during a re-run (AC 12)', () => {
  it('is refused as gated once the reversal committed, changing nothing', async () => {
    const hold = stepHold()
    const h = await openHarness(
      { ...STAND_IN, rerunSteps: [{ ...STAND_IN_STEP, held: hold }] },
      MOCKS,
    )
    await h.close()
    expect(h.closed().log.some((d) => d.targetTable === 'lore')).toBe(true)

    const ending = h.rerun(closedChapterId(h))
    await within(hold.reached, "the re-run's first tool step")
    const log = await branchLog(h.fx)
    // The reversal committed: the close's lore write sits in the journal, not the log.
    expect(log.filter((d) => d.actionId === h.actionId() && d.targetTable === 'lore')).toEqual([])

    expect(await undoLastAction(h.fx.branchId, h.fx.ctx)).toEqual({
      status: 'rejected',
      code: 'gated',
      reason: 'generation in flight',
    })

    expect(await branchLog(h.fx)).toEqual(log)
    hold.release()
    const end = await within(ending, 'the re-run')
    expect(end).toMatchObject({ kind: CHAPTER_CLOSE_KIND, result: { outcome: 'completed' } })
  })
})
