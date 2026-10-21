import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { PER_TURN_KIND, SUGGESTION_REFRESH_KIND } from '@/lib/pipeline'
import {
  awaitRunTerminal,
  generationStore,
  interruptMemoryRuns,
  type RunState,
  type TxState,
} from '@/lib/stores'

import {
  abortedBeforeTurn,
  cancelComposerRun,
  cancelPillRun,
  cancelSendRun,
  findSendRun,
  pillRunOf,
  sendRunStreams,
} from './send-run'

// Spies that run the real thing, so a test can read either the call or the store it moved.
vi.mock('@/lib/stores', async (importOriginal) => {
  const actual = await importOriginal<{
    interruptMemoryRuns: typeof interruptMemoryRuns
    awaitRunTerminal: typeof awaitRunTerminal
  }>()
  return {
    ...actual,
    interruptMemoryRuns: vi.fn(actual.interruptMemoryRuns),
    awaitRunTerminal: vi.fn(actual.awaitRunTerminal),
  }
})

function run(fields: Partial<RunState> & Pick<RunState, 'runId' | 'kind'>): RunState {
  return {
    gateBehavior: 'hard-gate',
    actionId: `act_${fields.runId}`,
    storyId: 'story_1',
    branchId: 'br_1',
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
    interruptible: null,
    beforeTurn: false,
    ...fields,
  }
}

function txOf(...runs: RunState[]): TxState {
  return {
    runs: new Map(runs.map((r) => [r.runId, r])),
    reversalInProgress: false,
    pendingTurns: new Set(),
    deferred: new Map(),
  }
}

// In the real store, ending as the orchestrator does on an abort: removed, a pass deferred.
function startLive(template: RunState): RunState {
  let resolveTerminal!: () => void
  const terminal = new Promise<void>((resolve) => {
    resolveTerminal = resolve
  })
  const live: RunState = {
    ...template,
    abortController: new AbortController(),
    terminal,
    resolveTerminal,
  }
  live.abortController.signal.addEventListener(
    'abort',
    () => {
      generationStore.abortRun(live.runId, 'aborted')
      live.resolveTerminal()
    },
    { once: true },
  )
  generationStore.startRun(live)
  return live
}

const TURN = run({ runId: 'run_turn', kind: PER_TURN_KIND })
const CHAINED_PASS = run({
  runId: 'run_pass',
  kind: PERIODIC_CLASSIFIER_KIND,
  interruptible: 'pass',
})
const DEFERRED_PASS = run({
  runId: 'run_deferred',
  kind: PERIODIC_CLASSIFIER_KIND,
  interruptible: 'pass',
  beforeTurn: true,
})
const REFRESH = run({ runId: 'run_refresh', kind: SUGGESTION_REFRESH_KIND })

beforeEach(() => {
  generationStore.__reset()
  vi.mocked(interruptMemoryRuns).mockClear()
  vi.mocked(awaitRunTerminal).mockClear()
})

describe('findSendRun', () => {
  it('finds the turn on the branch', () => {
    expect(findSendRun(txOf(REFRESH, TURN), 'br_1')).toBe(TURN)
  })

  it('finds the pass Send runs before the turn', () => {
    expect(findSendRun(txOf(DEFERRED_PASS), 'br_1')).toBe(DEFERRED_PASS)
  })

  // A chained pass leaves Send in place and refused, so the composer stays live; its
  // Cancel is the pill's and the banner's.
  it('passes over a pass chained after a turn', () => {
    expect(findSendRun(txOf(CHAINED_PASS), 'br_1')).toBeUndefined()
  })

  it('passes over a suggestion refresh', () => {
    expect(findSendRun(txOf(REFRESH), 'br_1')).toBeUndefined()
  })

  it("passes over another branch's turn", () => {
    const elsewhere = run({ runId: 'run_elsewhere', kind: PER_TURN_KIND, branchId: 'br_2' })
    expect(findSendRun(txOf(elsewhere), 'br_1')).toBeUndefined()
  })
})

describe('pillRunOf', () => {
  it('gives the pill to a chained pass over a refresh beside it', () => {
    expect(pillRunOf(txOf(REFRESH, CHAINED_PASS), 'br_1')).toBe(CHAINED_PASS)
  })

  it("reads Send's deferred pass through, marked before the turn", () => {
    expect(pillRunOf(txOf(DEFERRED_PASS), 'br_1')?.beforeTurn).toBe(true)
  })

  it('gives the turn the pill', () => {
    expect(pillRunOf(txOf(REFRESH, TURN), 'br_1')).toBe(TURN)
  })

  it('leaves a lone refresh to the strip', () => {
    expect(pillRunOf(txOf(REFRESH), 'br_1')).toBeUndefined()
  })
})

describe('sendRunStreams', () => {
  it('streams during the turn', () => {
    expect(sendRunStreams(txOf(TURN), 'br_1')).toBe(true)
  })

  it("streams nothing during Send's deferred pass", () => {
    expect(sendRunStreams(txOf(DEFERRED_PASS), 'br_1')).toBe(false)
  })

  it('streams nothing while no Send run is in flight', () => {
    expect(sendRunStreams(txOf(CHAINED_PASS, REFRESH), 'br_1')).toBe(false)
  })
})

describe('cancelSendRun', () => {
  it("interrupts Send's deferred pass", async () => {
    await cancelSendRun(DEFERRED_PASS)
    expect(interruptMemoryRuns).toHaveBeenCalledWith('br_1')
    expect(awaitRunTerminal).not.toHaveBeenCalled()
  })

  // The pill's Cancel reaches a chained pass through the same call.
  it('interrupts a chained pass', async () => {
    await cancelSendRun(CHAINED_PASS)
    expect(interruptMemoryRuns).toHaveBeenCalledWith('br_1')
    expect(awaitRunTerminal).not.toHaveBeenCalled()
  })

  it('cancels a turn through its terminal', async () => {
    await cancelSendRun(TURN)
    expect(awaitRunTerminal).toHaveBeenCalledWith(PER_TURN_KIND, 'br_1', 'cancel')
    expect(interruptMemoryRuns).not.toHaveBeenCalled()
  })
})

describe('cancelPillRun', () => {
  it('interrupts a chained pass, deferring it, and leaves the refresh beside it running', async () => {
    const refresh = startLive(REFRESH)
    const pass = startLive(CHAINED_PASS)

    await cancelPillRun('br_1')

    expect(pass.abortController.signal.aborted).toBe(true)
    expect(generationStore.getTxState().deferred.get('br_1')).toEqual({ pass: true })
    expect(refresh.abortController.signal.aborted).toBe(false)
    expect(generationStore.getTxState().runs.has(refresh.runId)).toBe(true)
  })

  it('cancels the refresh when it runs alone', async () => {
    const refresh = startLive(REFRESH)

    await cancelPillRun('br_1')

    expect(refresh.abortController.signal.aborted).toBe(true)
    expect(generationStore.getTxState().runs.size).toBe(0)
  })
})

describe('cancelComposerRun', () => {
  it("interrupts Send's deferred pass, keeping the work deferred", async () => {
    const pass = startLive(DEFERRED_PASS)

    await cancelComposerRun('br_1')

    expect(pass.abortController.signal.aborted).toBe(true)
    expect(generationStore.getTxState().runs.size).toBe(0)
    expect(generationStore.getTxState().deferred.get('br_1')).toEqual({ pass: true })
  })

  it('cancels the turn', async () => {
    const turn = startLive(TURN)

    await cancelComposerRun('br_1')

    expect(turn.abortController.signal.aborted).toBe(true)
  })

  // The pill and the banner own a chained pass's Cancel; the composer has none to offer.
  it('leaves a chained pass running', async () => {
    const pass = startLive(CHAINED_PASS)

    await cancelComposerRun('br_1')

    expect(pass.abortController.signal.aborted).toBe(false)
  })
})

describe('abortedBeforeTurn', () => {
  const ran = { runId: 'run_1', actionId: 'act_1' }

  it('holds for a Send cancelled during its deferred pass, which wrote nothing', () => {
    expect(abortedBeforeTurn({ ...ran, outcome: 'aborted', beforeTurn: true })).toBe(true)
  })

  // The turn wrote its user action before the cancel reversed it.
  it('holds for no cancel of the turn itself', () => {
    expect(abortedBeforeTurn({ ...ran, outcome: 'aborted' })).toBe(false)
  })

  it('holds for no Send that ran or was refused', () => {
    expect(abortedBeforeTurn({ ...ran, outcome: 'completed' })).toBe(false)
    expect(abortedBeforeTurn({ ...ran, outcome: 'failed' })).toBe(false)
    expect(abortedBeforeTurn({ outcome: 'rejected', blockedBy: 'turn', converged: true })).toBe(
      false,
    )
  })
})
