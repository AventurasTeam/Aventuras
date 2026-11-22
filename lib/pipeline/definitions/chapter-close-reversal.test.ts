import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { withBranchWriteShared } from '@/lib/actions/delta/branch-write-lock'
import { makeLogger } from '@/lib/diagnostics'
import { generationStore } from '@/lib/stores'

import { closeReversalPhase } from './chapter-close-reversal'
import { closeFloorOf, setCloseRange } from './close-intermediates'
import type { CloseRange } from './intermediates'
import { realDeltaActionPort, resetSingletons, within } from '../__tests__/harness'
import {
  configureDeltaActionPort,
  holdBranchWriteExclusive,
  releaseBranchWriteExclusive,
  type DeltaActionPort,
} from '../runtime/action-port'
import type { PhaseContext, PhaseResult } from '../types'

const RANGE: CloseRange = {
  chapterId: 'chap_11111111-1111-4111-8111-111111111111',
  startEntryId: 'e1',
  endEntryId: 'e5',
}

function phaseCtx(abortSignal: AbortSignal = new AbortController().signal): PhaseContext {
  const intermediates: Record<string, unknown> = {}
  setCloseRange(intermediates, RANGE)
  return {
    actionId: 'act_rerun',
    abortSignal,
    intermediates,
    log: makeLogger('act_rerun'),
    db: {} as PhaseContext['db'],
    runInTransaction: async () => undefined,
    storyId: 's1',
    branchId: 'b1',
  }
}

async function drain(ctx: PhaseContext): Promise<{ events: unknown[]; result: PhaseResult }> {
  const gen = closeReversalPhase(ctx)
  const events: unknown[] = []
  for (;;) {
    const next = await gen.next()
    if (next.done) return { events, result: next.value }
    events.push(next.value)
  }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const reverse = vi.fn<DeltaActionPort['reverseCloseForRerun']>()

beforeEach(() => {
  resetSingletons()
  reverse.mockReset()
  reverse.mockResolvedValue({ floor: 40 })
  configureDeltaActionPort({ ...realDeltaActionPort(), reverseCloseForRerun: reverse })
})

afterEach(() => resetSingletons())

const holdRerun = () => generationStore.setPendingRerun('b1', { chapterId: RANGE.chapterId })

// The phase ends holding nothing: another action's exclusive hold is granted at once.
async function expectLockFree(): Promise<void> {
  await within(holdBranchWriteExclusive('b1', 'act_next'), 'the next exclusive hold')
  releaseBranchWriteExclusive('b1', 'act_next')
}

describe('closeReversalPhase', () => {
  it('passes a close straight through: no hold, no reversal, no floor', async () => {
    const hold = vi.fn<DeltaActionPort['holdBranchWriteExclusive']>(async () => {})
    configureDeltaActionPort({
      ...realDeltaActionPort(),
      reverseCloseForRerun: reverse,
      holdBranchWriteExclusive: hold,
    })
    generationStore.setPendingRerun('b2', { chapterId: RANGE.chapterId })
    const ctx = phaseCtx()

    expect(await drain(ctx)).toEqual({ events: [], result: { status: 'completed' } })

    expect(hold).not.toHaveBeenCalled()
    expect(reverse).not.toHaveBeenCalled()
    expect(closeFloorOf(ctx.intermediates)).toBeUndefined()
  })

  it("reverses the chapter's lore under the run's action and parks the floor", async () => {
    holdRerun()
    const ctx = phaseCtx()

    expect(await drain(ctx)).toEqual({ events: [], result: { status: 'completed' } })

    expect(reverse).toHaveBeenCalledTimes(1)
    expect(reverse).toHaveBeenCalledWith(
      { branchId: 'b1', chapterId: RANGE.chapterId, actionId: 'act_rerun' },
      ctx,
    )
    expect(closeFloorOf(ctx.intermediates)).toBe(40)
    await expectLockFree()
  })

  // generation-pipeline.md → Branch write lock: a preview's reads never straddle the reversal.
  it('holds the branch exclusive across the reversal: a preview asking meanwhile reads after it', async () => {
    holdRerun()
    const order: string[] = []
    let preview: Promise<void> | undefined
    reverse.mockImplementation(async () => {
      preview = withBranchWriteShared('b1', 'act_preview', async () => {
        order.push('preview read')
      })
      await tick()
      order.push('reversal committed')
      return { floor: 40 }
    })

    expect((await drain(phaseCtx())).result).toEqual({ status: 'completed' })
    await within(preview!, 'the preview')

    expect(order).toEqual(['reversal committed', 'preview read'])
  })

  it('commits no reversal when Cancel lands while its hold waits on a reader', async () => {
    holdRerun()
    let endRead!: () => void
    const reading = withBranchWriteShared(
      'b1',
      'act_preview',
      () => new Promise<void>((resolve) => (endRead = resolve)),
    )
    const controller = new AbortController()
    const ctx = phaseCtx(controller.signal)

    const phase = drain(ctx)
    await tick()
    expect(reverse).not.toHaveBeenCalled()
    controller.abort()
    endRead()
    await reading

    expect((await within(phase, 'the phase')).result).toEqual({ status: 'aborted' })
    expect(reverse).not.toHaveBeenCalled()
    expect(closeFloorOf(ctx.intermediates)).toBeUndefined()
    await expectLockFree()
  })

  it('fails the run on a throw, releasing its hold', async () => {
    holdRerun()
    reverse.mockRejectedValue(new Error('disk full'))

    await expect(drain(phaseCtx())).rejects.toThrow('disk full')

    await expectLockFree()
  })

  it('fails as an orchestrator fault under a re-run with no range parked', async () => {
    holdRerun()
    const ctx = phaseCtx()
    delete ctx.intermediates.closeRange

    expect((await drain(ctx)).result).toEqual({
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'chapter-close: no close range' },
    })
    expect(reverse).not.toHaveBeenCalled()
  })
})
