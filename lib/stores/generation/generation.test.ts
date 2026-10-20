import { beforeEach, describe, expect, it } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'

import {
  awaitRunTerminal,
  backgroundClassifierRunning,
  cancelStoryRuns,
  deferredWorkKindOf,
  generationStore,
  interruptMemoryRuns,
  isForegroundGenerating,
  isHeadReversalBlocked,
  isStoryBusy,
  isUserEditBlocked,
  type RunState,
  type TxState,
} from './generation'

function run(id: string, kind = 'synthetic'): RunState {
  return {
    runId: id,
    kind,
    gateBehavior: 'hard-gate',
    interruptible: false,
    beforeTurn: false,
    actionId: `act_${id}`,
    storyId: 's1',
    branchId: 'b1',
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  }
}

// An interruptible pass on b1, as the orchestrator reserves it.
function pass(id: string, over: Partial<RunState> = {}): RunState {
  return { ...run(id, PERIODIC_CLASSIFIER_KIND), interruptible: true, ...over }
}

function tx(runs: RunState[], over: Partial<TxState> = {}): TxState {
  return {
    runs: new Map(runs.map((r) => [r.runId, r])),
    reversalInProgress: false,
    pendingTurns: new Set(),
    deferred: new Map(),
    ...over,
  }
}

const deferredOn = (branchId: string) => generationStore.getTxState().deferred.get(branchId)

describe('isUserEditBlocked', () => {
  it('blocks only when a hard-gate run is in flight', () => {
    const mk = (kind: string, gate: 'hard-gate' | 'no-gate') => ({
      ...run(kind),
      gateBehavior: gate,
    })
    expect(isUserEditBlocked(tx([]))).toBe(false)
    expect(isUserEditBlocked(tx([mk('bg', 'no-gate')]))).toBe(false)
    expect(isUserEditBlocked(tx([mk('bg', 'no-gate'), mk('fg', 'hard-gate')]))).toBe(true)
    expect(isUserEditBlocked(tx([], { reversalInProgress: true }))).toBe(true)
  })

  // generation-pipeline.md → No-gate write phase: a reversal opened between a Send and its run's
  // registration would have the turn's queued user_action refused.
  it('blocks while a turn is pending, on any branch', () => {
    const blocked = (pendingTurns: TxState['pendingTurns']) =>
      isUserEditBlocked(tx([], { pendingTurns }))
    expect(blocked(new Set([{ branchId: 'b2' }]))).toBe(true)
    expect(blocked(new Set())).toBe(false)
  })
})

describe('isHeadReversalBlocked', () => {
  beforeEach(() => {
    generationStore.__reset()
  })

  const refresh = (): RunState => run('run_refresh', 'suggestion-refresh')

  it('lets a head reversal through when only an interruptible run on the branch holds the gate', () => {
    expect(isHeadReversalBlocked(tx([]), 'b1')).toBe(false)
    expect(isHeadReversalBlocked(tx([pass('run_pass')]), 'b1')).toBe(false)
    // The plain gate stays closed for everything else.
    expect(isUserEditBlocked(tx([pass('run_pass')]))).toBe(true)
  })

  it('blocks while a refresh runs beside the pass', () => {
    expect(isHeadReversalBlocked(tx([pass('run_pass'), refresh()]), 'b1')).toBe(true)
  })

  it('blocks while a turn is pending or a reversal runs', () => {
    expect(
      isHeadReversalBlocked(
        tx([pass('run_pass')], { pendingTurns: new Set([{ branchId: 'b1' }]) }),
        'b1',
      ),
    ).toBe(true)
    expect(isHeadReversalBlocked(tx([pass('run_pass')], { reversalInProgress: true }), 'b1')).toBe(
      true,
    )
    // A turn pending on another branch blocks too: the gate it is about to raise is app-wide.
    expect(
      isHeadReversalBlocked(
        tx([pass('run_pass')], { pendingTurns: new Set([{ branchId: 'b2' }]) }),
        'b1',
      ),
    ).toBe(true)
  })

  it('blocks when the interruptible run is on another branch', () => {
    expect(isHeadReversalBlocked(tx([pass('run_pass', { branchId: 'b2' })]), 'b1')).toBe(true)
  })

  it('blocks on a hard-gate run that is not interruptible', () => {
    expect(isHeadReversalBlocked(tx([run('run_turn', 'per-turn')]), 'b1')).toBe(true)
    const background: RunState = { ...run('run_bg'), gateBehavior: 'no-gate' }
    expect(isHeadReversalBlocked(tx([background]), 'b1')).toBe(false)
  })

  it('reads the live state through the store namespace', () => {
    generationStore.startRun(pass('run_pass'))
    expect(generationStore.isHeadReversalBlocked('b1')).toBe(false)
    expect(generationStore.isHeadReversalBlocked('b2')).toBe(true)
    generationStore.startRun(refresh())
    expect(generationStore.isHeadReversalBlocked('b1')).toBe(true)
  })
})

describe('isStoryBusy', () => {
  it('is busy with a run on the story, a turn pending on its branch, or a reversal', () => {
    expect(isStoryBusy(tx([]), 's1', 'b1')).toBe(false)
    expect(isStoryBusy(tx([run('run_turn', 'per-turn')]), 's1', 'b1')).toBe(true)
    expect(isStoryBusy(tx([{ ...run('run_other'), storyId: 's2' }]), 's1', 'b1')).toBe(false)
    expect(isStoryBusy(tx([{ ...run('run_b2'), branchId: 'b2' }]), 's1', 'b1')).toBe(true)
    expect(isStoryBusy(tx([], { pendingTurns: new Set([{ branchId: 'b1' }]) }), 's1', 'b1')).toBe(
      true,
    )
    expect(isStoryBusy(tx([], { pendingTurns: new Set([{ branchId: 'b2' }]) }), 's1', 'b1')).toBe(
      false,
    )
    expect(isStoryBusy(tx([], { reversalInProgress: true }), 's1', 'b1')).toBe(true)
  })
})

describe('deferredWorkKindOf', () => {
  it('maps the pass and the close, and nothing else', () => {
    expect(deferredWorkKindOf(PERIODIC_CLASSIFIER_KIND)).toBe('pass')
    expect(deferredWorkKindOf('chapter-close')).toBe('close')
    expect(deferredWorkKindOf('per-turn')).toBeNull()
    expect(deferredWorkKindOf('suggestion-refresh')).toBeNull()
    expect(deferredWorkKindOf('toString')).toBeNull()
  })
})

describe('deferred work', () => {
  beforeEach(() => {
    generationStore.__reset()
  })

  it('records an aborted pass on its branch in the same update that removes the run', () => {
    generationStore.startRun(pass('run_pass'))
    const seen: { registered: boolean; deferred: unknown }[] = []
    const off = generationStore.subscribe(() => {
      const state = generationStore.getTxState()
      seen.push({ registered: state.runs.has('run_pass'), deferred: state.deferred.get('b1') })
    })
    let recorded: boolean
    try {
      recorded = generationStore.abortRun('run_pass', 'aborted')
    } finally {
      off()
    }
    expect(recorded).toBe(true)
    expect(seen).toEqual([{ registered: false, deferred: { pass: true } }])
  })

  it('returns false when the work was already deferred, and keeps the record', () => {
    generationStore.startRun(pass('run_first'))
    generationStore.abortRun('run_first', 'aborted')
    generationStore.startRun(pass('run_send', { beforeTurn: true }))
    expect(generationStore.abortRun('run_send', 'aborted')).toBe(false)
    expect(deferredOn('b1')).toEqual({ pass: true })
  })

  it('clears the record when a pass commits, with or without a successor', () => {
    generationStore.startRun(pass('run_first'))
    generationStore.abortRun('run_first', 'aborted')
    generationStore.startRun(pass('run_send'))
    generationStore.finishRun('run_send')
    expect(generationStore.getTxState().deferred.has('b1')).toBe(false)

    generationStore.startRun(pass('run_again'))
    generationStore.abortRun('run_again', 'aborted')
    generationStore.startRun(pass('run_chained'))
    generationStore.finishRun('run_chained', run('run_next'))
    expect(generationStore.getTxState().deferred.has('b1')).toBe(false)
  })

  it('clears the record when a pass fails, and records nothing new', () => {
    generationStore.startRun(pass('run_first'))
    generationStore.abortRun('run_first', 'aborted')
    generationStore.startRun(pass('run_send'))
    expect(generationStore.abortRun('run_send', 'failed')).toBe(false)
    expect(generationStore.getTxState().deferred.has('b1')).toBe(false)

    generationStore.startRun(pass('run_fresh'))
    expect(generationStore.abortRun('run_fresh', 'failed')).toBe(false)
    expect(generationStore.getTxState().deferred.size).toBe(0)
  })

  it('leaves the record alone when the abort names no outcome (a marker-insert unwind)', () => {
    generationStore.startRun(pass('run_first'))
    generationStore.abortRun('run_first', 'aborted')
    generationStore.startRun(pass('run_unwound'))
    expect(generationStore.abortRun('run_unwound')).toBe(false)
    expect(generationStore.getTxState().runs.has('run_unwound')).toBe(false)
    expect(deferredOn('b1')).toEqual({ pass: true })

    generationStore.startRun(pass('run_clean', { branchId: 'b2' }))
    generationStore.abortRun('run_clean')
    expect(generationStore.getTxState().deferred.has('b2')).toBe(false)
  })

  it('keeps a pass and a close side by side and clears each on its own', () => {
    generationStore.startRun(pass('run_pass'))
    generationStore.abortRun('run_pass', 'aborted')
    generationStore.startRun(pass('run_close', { kind: 'chapter-close' }))
    expect(generationStore.abortRun('run_close', 'aborted')).toBe(true)
    expect(deferredOn('b1')).toEqual({ pass: true, close: true })

    generationStore.startRun(pass('run_send'))
    generationStore.finishRun('run_send')
    expect(deferredOn('b1')).toEqual({ close: true })
  })

  it('keys the record by the run branch', () => {
    generationStore.startRun(pass('run_b1'))
    generationStore.abortRun('run_b1', 'aborted')
    generationStore.startRun(pass('run_b2', { branchId: 'b2' }))
    generationStore.abortRun('run_b2', 'aborted')
    generationStore.startRun(pass('run_b2_send', { branchId: 'b2' }))
    generationStore.finishRun('run_b2_send')
    expect(deferredOn('b1')).toEqual({ pass: true })
    expect(generationStore.getTxState().deferred.has('b2')).toBe(false)
  })

  it('records nothing for an interruptible run of an unmapped kind', () => {
    generationStore.startRun(pass('run_other', { kind: 'some-interruptible' }))
    expect(generationStore.abortRun('run_other', 'aborted')).toBe(false)
    expect(generationStore.getTxState().deferred.size).toBe(0)
  })

  it('records nothing for a pass-kind run that is not interruptible', () => {
    generationStore.startRun(pass('run_plain', { interruptible: false }))
    expect(generationStore.abortRun('run_plain', 'aborted')).toBe(false)
    expect(generationStore.getTxState().deferred.size).toBe(0)
  })

  it('records nothing for an unknown run id', () => {
    expect(generationStore.abortRun('run_missing', 'aborted')).toBe(false)
    expect(generationStore.getTxState().deferred.size).toBe(0)
  })

  it('__reset empties the record', () => {
    generationStore.startRun(pass('run_pass'))
    generationStore.abortRun('run_pass', 'aborted')
    generationStore.__reset()
    expect(generationStore.getTxState().deferred.size).toBe(0)
  })
})

describe('pending turns', () => {
  beforeEach(() => {
    generationStore.__reset()
  })

  const pending = () => [...generationStore.getTxState().pendingTurns].map((t) => t.branchId)

  function holdTurn(branchId: string) {
    let endEarly!: () => void
    let settleBody!: (outcome: 'resolve' | 'reject') => void
    const bracket = generationStore.bracketPendingTurn(branchId, (end) => {
      endEarly = end
      return new Promise<void>((resolve, reject) => {
        settleBody = (outcome) => (outcome === 'resolve' ? resolve() : reject(new Error('boom')))
      })
    })
    return {
      endEarly: () => endEarly(),
      settle: (outcome: 'resolve' | 'reject' = 'resolve') => {
        settleBody(outcome)
        return bracket
      },
    }
  }

  it('holds a turn until its early end, once, beside another on the same branch', async () => {
    const first = holdTurn('b1')
    const second = holdTurn('b1')
    expect(pending()).toEqual(['b1', 'b1'])
    expect(generationStore.isUserEditBlocked()).toBe(true)
    first.endEarly()
    first.endEarly()
    expect(pending()).toEqual(['b1'])
    await first.settle()
    expect(pending()).toEqual(['b1'])
    second.endEarly()
    expect(pending()).toEqual([])
    expect(generationStore.isUserEditBlocked()).toBe(false)
    await second.settle()
  })

  it('ends the mark when the body settles without an early end, thrown or not', async () => {
    const resolved = holdTurn('b1')
    const thrown = holdTurn('b2')
    await resolved.settle('resolve')
    expect(pending()).toEqual(['b2'])
    await expect(thrown.settle('reject')).rejects.toThrow('boom')
    expect(pending()).toEqual([])
  })

  it('notifies subscribers when a turn ends, so a waiter wakes on a refused Send', async () => {
    const turn = holdTurn('b1')
    let calls = 0
    const unsubscribe = generationStore.subscribe(() => calls++)
    turn.endEarly()
    expect(calls).toBe(1)
    // The body leaving wakes a cancelStoryRuns waiting on it; the late mark end adds nothing.
    await turn.settle()
    expect(calls).toBe(2)
    unsubscribe()
  })

  it('ignores a late end after a reset, leaving a newer turn marked', async () => {
    const stale = holdTurn('b1')
    generationStore.__reset()
    holdTurn('b1')
    stale.endEarly()
    await stale.settle()
    expect(pending()).toEqual(['b1'])
  })

  it('keeps pending turns through run and reversal transitions', () => {
    holdTurn('b1')
    generationStore.startRun(run('run_1'))
    generationStore.finishRun('run_1')
    generationStore.setReversalInProgress(true)
    expect(pending()).toEqual(['b1'])
  })
})

describe('generation store', () => {
  beforeEach(() => {
    generationStore.__reset()
  })

  it('startRun adds, abortRun removes', () => {
    generationStore.startRun(run('run_1'))
    expect(generationStore.getTxState().runs.has('run_1')).toBe(true)
    generationStore.abortRun('run_1')
    expect(generationStore.getTxState().runs.has('run_1')).toBe(false)
  })

  it('finishRun(predecessor, successor) is atomic — no empty intermediate state', () => {
    generationStore.startRun(run('run_pred', 'per-turn'))
    generationStore.finishRun('run_pred', run('run_succ', 'chapter-close'))
    const runs = generationStore.getTxState().runs // synchronous read immediately after
    expect(runs.has('run_pred')).toBe(false)
    expect(runs.has('run_succ')).toBe(true)
    expect(runs.size).toBe(1)
  })
})

describe('settleCount', () => {
  beforeEach(() => {
    generationStore.__reset()
  })

  it('does not bump on startRun', () => {
    generationStore.startRun(run('run_1'))
    expect(generationStore.getSettleCount()).toBe(0)
  })

  it('bumps by one on finishRun', () => {
    generationStore.startRun(run('run_1'))
    generationStore.finishRun('run_1')
    expect(generationStore.getSettleCount()).toBe(1)
  })

  it('bumps by one on finishRun with a successor', () => {
    generationStore.startRun(run('run_1'))
    generationStore.finishRun('run_1', run('run_2'))
    expect(generationStore.getSettleCount()).toBe(1)
  })

  it('bumps by one on abortRun, with or without an outcome', () => {
    generationStore.startRun(run('run_1'))
    generationStore.abortRun('run_1')
    expect(generationStore.getSettleCount()).toBe(1)
    generationStore.startRun(pass('run_2'))
    generationStore.abortRun('run_2', 'aborted')
    expect(generationStore.getSettleCount()).toBe(2)
  })

  it('bumps by one when reversalInProgress settles true -> false', () => {
    generationStore.setReversalInProgress(true)
    expect(generationStore.getSettleCount()).toBe(0)
    generationStore.setReversalInProgress(false)
    expect(generationStore.getSettleCount()).toBe(1)
  })

  it('does not bump on false -> false or false -> true', () => {
    generationStore.setReversalInProgress(false)
    expect(generationStore.getSettleCount()).toBe(0)
    generationStore.setReversalInProgress(true)
    expect(generationStore.getSettleCount()).toBe(0)
  })

  it('__reset returns settleCount to 0', () => {
    generationStore.startRun(run('run_1'))
    generationStore.finishRun('run_1')
    expect(generationStore.getSettleCount()).toBe(1)
    generationStore.__reset()
    expect(generationStore.getSettleCount()).toBe(0)
  })
})

describe('isForegroundGenerating', () => {
  beforeEach(() => {
    generationStore.__reset()
  })

  function runFor(kind: string, branchId = 'branch_1'): RunState {
    return { ...run(`run_${kind}`, kind), branchId }
  }

  it('is false for a periodic-classifier run', () => {
    generationStore.startRun(runFor('periodic-classifier'))
    const tx = generationStore.getTxState()
    expect(isForegroundGenerating(tx, 'branch_1')).toBe(false)
    expect(backgroundClassifierRunning(tx, 'branch_1')).toBe(true)
    expect(backgroundClassifierRunning(tx, 'branch_other')).toBe(false)
  })

  it('is true for a per-turn run on the same branch', () => {
    generationStore.startRun(runFor('per-turn'))
    expect(isForegroundGenerating(generationStore.getTxState(), 'branch_1')).toBe(true)
  })

  it('ignores runs on other branches', () => {
    generationStore.startRun(runFor('per-turn', 'branch_other'))
    expect(isForegroundGenerating(generationStore.getTxState(), 'branch_1')).toBe(false)
  })

  // Denylist, not allowlist: a kind added later must default to foreground, so a
  // new pipeline shows the pill rather than running invisibly.
  it('treats an unknown kind as foreground', () => {
    generationStore.startRun(runFor('some-future-pipeline'))
    expect(isForegroundGenerating(generationStore.getTxState(), 'branch_1')).toBe(true)
  })
})

// A run with a real terminal. By default an abort ends it the way the orchestrator does: the run
// leaves txState, then its terminal resolves.
function liveRun(over: Partial<RunState> & { runId: string }, onAbort?: (r: RunState) => void) {
  let resolveTerminal!: () => void
  const terminal = new Promise<void>((resolve) => {
    resolveTerminal = resolve
  })
  const r: RunState = { ...run(over.runId), ...over, terminal, resolveTerminal }
  r.abortController.signal.addEventListener('abort', () => {
    if (onAbort) return onAbort(r)
    generationStore.abortRun(r.runId)
    r.resolveTerminal()
  })
  return r
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('interruptMemoryRuns', () => {
  beforeEach(() => {
    generationStore.__reset()
  })

  it('aborts every interruptible run on the branch and resolves once each has ended', async () => {
    const passRun = liveRun(pass('run_pass'), () => {})
    const closeRun = liveRun(pass('run_close', { kind: 'chapter-close' }), () => {})
    const refresh = liveRun({ runId: 'run_refresh', kind: 'suggestion-refresh' })
    const elsewhere = liveRun(pass('run_b2', { branchId: 'b2' }))
    for (const r of [passRun, closeRun, refresh, elsewhere]) generationStore.startRun(r)

    let done = false
    const interrupted = interruptMemoryRuns('b1').then(() => {
      done = true
    })
    expect(passRun.abortController.signal.aborted).toBe(true)
    expect(closeRun.abortController.signal.aborted).toBe(true)
    expect(refresh.abortController.signal.aborted).toBe(false)
    expect(elsewhere.abortController.signal.aborted).toBe(false)

    passRun.resolveTerminal()
    await flush()
    expect(done).toBe(false)
    closeRun.resolveTerminal()
    await interrupted
    expect(done).toBe(true)
  })

  it('records no deferral itself', async () => {
    generationStore.startRun(liveRun(pass('run_pass')))
    await interruptMemoryRuns('b1')
    expect(generationStore.getTxState().runs.size).toBe(0)
    expect(generationStore.getTxState().deferred.size).toBe(0)
  })

  it('resolves at once when no interruptible run is on the branch', async () => {
    await expect(interruptMemoryRuns('b1')).resolves.toBeUndefined()
  })
})

describe('cancelStoryRuns', () => {
  beforeEach(() => {
    generationStore.__reset()
  })

  it('aborts every run on the story, whatever its kind, and leaves other stories alone', async () => {
    const turn = liveRun({ runId: 'run_turn', kind: 'per-turn' })
    const memory = liveRun(pass('run_pass', { branchId: 'b2' }))
    const other = liveRun({ runId: 'run_other', storyId: 's2' })
    for (const r of [turn, memory, other]) generationStore.startRun(r)

    await cancelStoryRuns('s1', 'b1')
    expect(turn.abortController.signal.aborted).toBe(true)
    expect(memory.abortController.signal.aborted).toBe(true)
    expect(other.abortController.signal.aborted).toBe(false)
    expect([...generationStore.getTxState().runs.keys()]).toEqual(['run_other'])
    expect(generationStore.getTxState().deferred.size).toBe(0)
  })

  it('catches a run registered while it waited, as a turn that commits and chains a pass', async () => {
    const chained = liveRun(pass('run_chained'))
    // Past its last abort check, the turn commits anyway and swaps its successor in.
    const turn = liveRun({ runId: 'run_turn', kind: 'per-turn' }, (r) => {
      generationStore.finishRun(r.runId, chained)
      r.resolveTerminal()
    })
    generationStore.startRun(turn)

    await cancelStoryRuns('s1', 'b1')
    expect(chained.abortController.signal.aborted).toBe(true)
    expect(generationStore.getTxState().runs.size).toBe(0)
  })

  // A Send admitted on the branch but not yet reserved holds only its pending mark; its run
  // registers after the mark, as the branch queue's onReserved ends it.
  it('waits for a pending turn, aborts the run it reserves, then resolves', async () => {
    let reserve!: () => void
    const reserved = new Promise<void>((resolve) => {
      reserve = resolve
    })
    const turnRun = liveRun({ runId: 'run_turn', kind: 'per-turn' })
    const turn = generationStore.bracketPendingTurn('b1', async (endMark) => {
      await reserved
      generationStore.startRun(turnRun)
      endMark()
      await turnRun.terminal
    })

    let done = false
    const cancelled = cancelStoryRuns('s1', 'b1').then(() => {
      done = true
    })
    await flush()
    expect(done).toBe(false)

    reserve()
    await cancelled
    expect(turnRun.abortController.signal.aborted).toBe(true)
    expect(generationStore.getTxState().runs.size).toBe(0)
    await turn
  })

  it('resolves once a pending turn ends without reserving a run', async () => {
    let refuse!: () => void
    const refused = new Promise<void>((resolve) => {
      refuse = resolve
    })
    const turn = generationStore.bracketPendingTurn('b1', () => refused)

    let done = false
    const cancelled = cancelStoryRuns('s1', 'b1').then(() => {
      done = true
    })
    await flush()
    expect(done).toBe(false)

    refuse()
    await turn
    await cancelled
    expect(done).toBe(true)
  })

  it('waits for a reversal to finish', async () => {
    generationStore.setReversalInProgress(true)

    let done = false
    const cancelled = cancelStoryRuns('s1', 'b1').then(() => {
      done = true
    })
    await flush()
    expect(done).toBe(false)

    generationStore.setReversalInProgress(false)
    await cancelled
    expect(done).toBe(true)
  })

  // A failed regenerate's follow-up sweep raises the flag after its run left the store and its
  // mark ended; only the turn body still spans the gap.
  it('waits for the whole turn body, past a sweep raised after its run ended', async () => {
    const order: string[] = []
    const turnRun = liveRun({ runId: 'run_turn', kind: 'per-turn' })
    const turn = generationStore.bracketPendingTurn('b1', async (endMark) => {
      generationStore.startRun(turnRun)
      endMark()
      await turnRun.terminal
      for (let hop = 0; hop < 5; hop++) await Promise.resolve()
      generationStore.setReversalInProgress(true)
      order.push('sweep start')
      await flush()
      generationStore.setReversalInProgress(false)
      order.push('sweep end')
    })

    await cancelStoryRuns('s1', 'b1')
    order.push('cancel resolved')
    expect(order).toEqual(['sweep start', 'sweep end', 'cancel resolved'])
    await turn
  })

  it('is not held by a turn body on another branch', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const elsewhere = generationStore.bracketPendingTurn('b2', async (endMark) => {
      endMark()
      await held
    })

    let done = false
    void cancelStoryRuns('s1', 'b1').then(() => {
      done = true
    })
    await flush()
    expect(done).toBe(true)

    release()
    await elsewhere
  })

  // The terminal is a thenable that removes the run itself after a few reads, so a regression
  // (a microtask spin that starves timers) fails the count instead of hanging the worker.
  it('waits for a store change when an aborted run is still registered', async () => {
    let reads = 0
    const stuck = liveRun(
      { runId: 'run_stuck', kind: 'per-turn' },
      (r) => void setTimeout(() => generationStore.abortRun(r.runId), 0),
    )
    stuck.terminal = {
      then: (resolve: () => void) => {
        if (++reads > 50) generationStore.abortRun(stuck.runId)
        resolve()
      },
    } as unknown as Promise<void>
    generationStore.startRun(stuck)

    await cancelStoryRuns('s1', 'b1')
    expect(generationStore.getTxState().runs.size).toBe(0)
    expect(reads).toBeLessThanOrEqual(2)
  })

  it('resolves at once when nothing on the story is busy', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    generationStore.startRun(liveRun({ runId: 'run_other', storyId: 's2' }))
    const elsewhere = generationStore.bracketPendingTurn('b2', () => held)

    let done = false
    void cancelStoryRuns('s1', 'b1').then(() => {
      done = true
    })
    // Nothing changes in the store meanwhile, so a wait for a change would never wake.
    await flush()
    expect(done).toBe(true)

    release()
    await elsewhere
  })
})

describe('awaitRunTerminal', () => {
  function runFor(kind: string, branchId = 'branch_1'): RunState {
    let resolveTerminal!: () => void
    const terminal = new Promise<void>((r) => {
      resolveTerminal = r
    })
    return {
      ...run(`run_${kind}_${branchId}`, kind),
      actionId: 'act_1',
      storyId: 'story_1',
      branchId,
      terminal,
      resolveTerminal,
    }
  }

  it('resolves immediately when no run of the kind is in flight', async () => {
    await expect(
      awaitRunTerminal('periodic-classifier', 'branch_1', 'cancel'),
    ).resolves.toBeUndefined()
  })

  it('aborts then awaits the terminal on cancel', async () => {
    const run = runFor('periodic-classifier')
    generationStore.startRun(run)
    const waited = awaitRunTerminal('periodic-classifier', 'branch_1', 'cancel')
    expect(run.abortController.signal.aborted).toBe(true)
    run.resolveTerminal()
    await expect(waited).resolves.toBeUndefined()
  })

  // Kind-only matching let a reversal on one branch abort the other branch's run
  // and then sweep while it was still writing.
  it('ignores a run of the same kind on another branch', async () => {
    const other = runFor('periodic-classifier', 'branch_other')
    generationStore.startRun(other)
    await expect(
      awaitRunTerminal('periodic-classifier', 'branch_1', 'cancel'),
    ).resolves.toBeUndefined()
    expect(other.abortController.signal.aborted).toBe(false)
  })

  it('cancels only the run on the requested branch', async () => {
    const mine = runFor('periodic-classifier', 'branch_1')
    const other = runFor('periodic-classifier', 'branch_other')
    generationStore.startRun(mine)
    generationStore.startRun(other)
    const waited = awaitRunTerminal('periodic-classifier', 'branch_1', 'cancel')
    expect(mine.abortController.signal.aborted).toBe(true)
    expect(other.abortController.signal.aborted).toBe(false)
    mine.resolveTerminal()
    await expect(waited).resolves.toBeUndefined()
  })

  it('does not abort on finish', async () => {
    const run = runFor('periodic-classifier')
    generationStore.startRun(run)
    const waited = awaitRunTerminal('periodic-classifier', 'branch_1', 'finish')
    expect(run.abortController.signal.aborted).toBe(false)
    run.resolveTerminal()
    await waited
  })
})
