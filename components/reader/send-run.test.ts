import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { CLASSIFIER_HELD, PER_TURN_KIND, SUGGESTION_REFRESH_KIND } from '@/lib/pipeline'
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
  composerShowsCancel,
  findSendRun,
  passRefusalOf,
  pillRunOf,
  sendGapOpen,
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

function pendingOn(branchId: string, ...runs: RunState[]): TxState {
  return { ...txOf(...runs), pendingTurns: new Set([{ branchId }]) }
}

// A turn marked pending in the real store, as a Send holds it until its run registers.
function holdPendingTurn(branchId: string): { end: () => Promise<void> } {
  let finish!: () => void
  const body = new Promise<void>((resolve) => {
    finish = resolve
  })
  const bracket = generationStore.bracketPendingTurn(branchId, () => body)
  return {
    end: () => {
      finish()
      return bracket
    },
  }
}

// Whether `promise` settled within a macrotask, so a test can say it is still waiting.
async function settledYet(promise: Promise<unknown>): Promise<boolean> {
  let settled = false
  void promise.then(() => {
    settled = true
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  return settled
}

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

    await cancelComposerRun('br_1', true)

    expect(pass.abortController.signal.aborted).toBe(true)
    expect(generationStore.getTxState().runs.size).toBe(0)
    expect(generationStore.getTxState().deferred.get('br_1')).toEqual({ pass: true })
  })

  it('cancels the turn', async () => {
    const turn = startLive(TURN)

    await cancelComposerRun('br_1', true)

    expect(turn.abortController.signal.aborted).toBe(true)
  })

  // The pill and the banner own a chained pass's Cancel; the composer has none to offer.
  it('leaves a chained pass running', async () => {
    const pass = startLive(CHAINED_PASS)

    await cancelComposerRun('br_1', true)

    expect(pass.abortController.signal.aborted).toBe(false)
  })
})

describe('composerShowsCancel', () => {
  it("shows Cancel over Send's run", () => {
    expect(composerShowsCancel(txOf(TURN), 'br_1', true)).toBe(true)
    expect(composerShowsCancel(txOf(DEFERRED_PASS), 'br_1', false)).toBe(true)
  })

  // Between Send's owed pass and its turn, only the pending mark holds.
  it("holds Cancel through the gap while this host's Send has a turn pending", () => {
    expect(composerShowsCancel(pendingOn('br_1'), 'br_1', true)).toBe(true)
  })

  // A regenerate's mark spans its sweep; its composer keeps the disabled Send.
  it("keeps Send for a pending turn that isn't this host's Send", () => {
    expect(composerShowsCancel(pendingOn('br_1'), 'br_1', false)).toBe(false)
  })

  it("keeps Send once the Send's mark has ended, as a chained pass runs on", () => {
    expect(composerShowsCancel(txOf(CHAINED_PASS), 'br_1', true)).toBe(false)
  })

  it("keeps Send for another branch's pending turn", () => {
    expect(composerShowsCancel(pendingOn('br_2'), 'br_1', true)).toBe(false)
  })
})

describe('cancelComposerRun in the handoff gap', () => {
  it('waits for the turn a pending Send registers, then cancels it', async () => {
    const mark = holdPendingTurn('br_1')

    const cancel = cancelComposerRun('br_1', true)
    expect(await settledYet(cancel)).toBe(false)
    const turn = startLive(TURN)
    await cancel

    expect(turn.abortController.signal.aborted).toBe(true)
    await mark.end()
  })

  it('cancels the deferred pass a pending Send registers', async () => {
    const mark = holdPendingTurn('br_1')

    const cancel = cancelComposerRun('br_1', true)
    const pass = startLive(DEFERRED_PASS)
    await cancel

    expect(pass.abortController.signal.aborted).toBe(true)
    await mark.end()
  })

  it('resolves, aborting nothing, when the mark ends with no Send run', async () => {
    const mark = holdPendingTurn('br_1')
    const cancel = cancelComposerRun('br_1', true)
    const refresh = startLive(REFRESH)
    expect(await settledYet(cancel)).toBe(false)

    await mark.end()
    await cancel

    expect(refresh.abortController.signal.aborted).toBe(false)
    const turn = startLive(TURN)
    expect(turn.abortController.signal.aborted).toBe(false)
  })

  it("waits on no pending turn that isn't this host's Send", async () => {
    const mark = holdPendingTurn('br_1')

    expect(await settledYet(cancelComposerRun('br_1', false))).toBe(true)
    const turn = startLive(TURN)

    expect(turn.abortController.signal.aborted).toBe(false)
    await mark.end()
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
    expect(abortedBeforeTurn({ ...ran, outcome: 'aborted', beforeTurn: undefined })).toBe(false)
  })

  it('holds for no Send that ran or was refused', () => {
    expect(abortedBeforeTurn({ ...ran, outcome: 'completed' })).toBe(false)
    expect(abortedBeforeTurn({ ...ran, outcome: 'failed' })).toBe(false)
    expect(abortedBeforeTurn({ outcome: 'rejected', blockedBy: 'turn', converged: true })).toBe(
      false,
    )
  })
})

describe('sendGapOpen', () => {
  it("opens while this host's Send has a turn pending and no run registered", () => {
    expect(sendGapOpen(pendingOn('br_1'), 'br_1', true)).toBe(true)
  })

  it("closes once Send's pass or its turn registers", () => {
    expect(sendGapOpen(pendingOn('br_1', DEFERRED_PASS), 'br_1', true)).toBe(false)
    expect(sendGapOpen(pendingOn('br_1', TURN), 'br_1', true)).toBe(false)
  })

  // A regenerate's mark spans its sweep; it is not Send's gap.
  it("stays shut for a pending turn that isn't this host's Send", () => {
    expect(sendGapOpen(pendingOn('br_1'), 'br_1', false)).toBe(false)
  })

  it("stays shut for another branch's pending turn, and with nothing pending", () => {
    expect(sendGapOpen(pendingOn('br_2'), 'br_1', true)).toBe(false)
    expect(sendGapOpen(txOf(), 'br_1', true)).toBe(false)
  })
})

describe('passRefusalOf', () => {
  const ran = { runId: 'run_1', actionId: 'act_1' }
  const error = {
    kind: 'provider',
    reason: 'timeout',
    detail: 'classifier: timeout after 600000ms',
  } as const

  it("reads a failed owed pass as the Send's refusal, with its cause", () => {
    expect(passRefusalOf({ ...ran, outcome: 'failed', beforeTurn: true, error })).toEqual({
      held: false,
      error,
    })
  })

  it('reads the held rejection as a hold', () => {
    expect(
      passRefusalOf({ outcome: 'rejected', blockedBy: CLASSIFIER_HELD, converged: true }),
    ).toEqual({ held: true })
  })

  // The turn's own failure reversed its user action: that is the turn-failure entry's case.
  it("leaves a failed turn to the turn's failure entry", () => {
    expect(passRefusalOf({ ...ran, outcome: 'failed', error })).toBeNull()
    expect(passRefusalOf({ ...ran, outcome: 'failed', beforeTurn: undefined, error })).toBeNull()
  })

  it('leaves any other refusal, a cancel and a landed turn alone', () => {
    expect(
      passRefusalOf({ outcome: 'rejected', blockedBy: 'translation-retry', converged: true }),
    ).toBeNull()
    expect(passRefusalOf({ ...ran, outcome: 'aborted', beforeTurn: true })).toBeNull()
    expect(passRefusalOf({ ...ran, outcome: 'completed' })).toBeNull()
  })
})
