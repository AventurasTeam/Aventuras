import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  __resetBranchWriteLocks,
  holdBranchWriteExclusive,
  releaseBranchWriteExclusive,
  withBranchWriteShared,
} from '@/lib/actions/delta/branch-write-lock'
import { generationStore, type RunState } from '@/lib/stores'

import { configureDeltaActionPort, type DeltaActionPort } from './action-port'
import { enterWritePhase } from './write-phase'
import { PER_TURN_KIND } from '../definitions/per-turn'

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function runOf(kind: string, branchId = 'b1'): RunState {
  return {
    runId: `run_${kind}_${branchId}`,
    kind,
    gateBehavior: 'hard-gate',
    actionId: `act_${kind}`,
    storyId: 's1',
    branchId,
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  }
}

// Settles as soon as the lock lets a shared write from outside the run through.
function sharedWrite(): { settled: () => boolean } {
  let settled = false
  void withBranchWriteShared('b1', 'act_probe', async () => {
    settled = true
  })
  return { settled: () => settled }
}

function track(promise: Promise<boolean>): { result: () => boolean | undefined } {
  let result: boolean | undefined
  void promise.then((value) => {
    result = value
  })
  return { result: () => result }
}

const PASS = { branchId: 'b1', actionId: 'act_pass' }

describe('enterWritePhase', () => {
  let controller: AbortController
  const enter = () => track(enterWritePhase({ ...PASS, abortSignal: controller.signal }))

  beforeEach(() => {
    generationStore.__reset()
    __resetBranchWriteLocks()
    controller = new AbortController()
    configureDeltaActionPort({
      holdWritePhase: holdBranchWriteExclusive,
      releaseWritePhase: releaseBranchWriteExclusive,
    } as Partial<DeltaActionPort> as DeltaActionPort)
  })

  afterEach(() => releaseBranchWriteExclusive('b1', PASS.actionId))

  it('holds the lock exclusive at once when no turn is in flight', async () => {
    const pass = enter()
    await flush()
    expect(pass.result()).toBe(true)
    const probe = sharedWrite()
    await flush()
    expect(probe.settled()).toBe(false)
  })

  it('waits out a per-turn run on its branch, holding nothing meanwhile', async () => {
    generationStore.startRun(runOf(PER_TURN_KIND))
    const pass = enter()
    await flush()
    expect(pass.result()).toBeUndefined()
    const probe = sharedWrite()
    await flush()
    expect(probe.settled()).toBe(true)

    generationStore.finishRun(runOf(PER_TURN_KIND).runId)
    await flush()
    expect(pass.result()).toBe(true)
  })

  it('waits out a pending turn, waking when it ends without ever registering a run', async () => {
    const end = generationStore.beginPendingTurn('b1')
    const pass = enter()
    await flush()
    expect(pass.result()).toBeUndefined()
    end()
    await flush()
    expect(pass.result()).toBe(true)
  })

  it("stays waiting across a pending turn's hand-off to its registered run", async () => {
    const end = generationStore.beginPendingTurn('b1')
    const pass = enter()
    await flush()
    generationStore.startRun(runOf(PER_TURN_KIND))
    end()
    await flush()
    expect(pass.result()).toBeUndefined()
    generationStore.finishRun(runOf(PER_TURN_KIND).runId)
    await flush()
    expect(pass.result()).toBe(true)
  })

  // A chained close drains the pass with 'finish': waiting on it too would deadlock.
  it('waits on per-turn runs only, and only on its own branch', async () => {
    generationStore.startRun(runOf('chapter-close'))
    generationStore.startRun(runOf('suggestion-refresh'))
    generationStore.startRun(runOf(PER_TURN_KIND, 'b2'))
    generationStore.beginPendingTurn('b2')
    const pass = enter()
    await flush()
    expect(pass.result()).toBe(true)
  })

  it('returns false on a cancel during the wait, holding and queuing nothing', async () => {
    generationStore.startRun(runOf(PER_TURN_KIND))
    const pass = enter()
    await flush()
    controller.abort()
    await flush()
    expect(pass.result()).toBe(false)
    generationStore.finishRun(runOf(PER_TURN_KIND).runId)
    const probe = sharedWrite()
    await flush()
    expect(probe.settled()).toBe(true)
  })

  it('drops its queued request on a cancel, so later writes are not held behind it', async () => {
    let releaseHolder!: () => void
    void withBranchWriteShared(
      'b1',
      'act_holder',
      () => new Promise<void>((resolve) => (releaseHolder = resolve)),
    )
    const pass = enter()
    await flush()
    expect(pass.result()).toBeUndefined()
    const queued = sharedWrite()
    await flush()
    expect(queued.settled()).toBe(false)

    controller.abort()
    await flush()
    expect(pass.result()).toBe(false)
    expect(queued.settled()).toBe(true)
    releaseHolder()
  })

  it('returns false at once when already cancelled', async () => {
    controller.abort()
    const pass = enter()
    await flush()
    expect(pass.result()).toBe(false)
    expect(sharedWrite().settled()).toBe(true)
  })
})
