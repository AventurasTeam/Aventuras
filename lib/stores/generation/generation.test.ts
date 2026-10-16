import { beforeEach, describe, expect, it } from 'vitest'

import {
  awaitRunTerminal,
  backgroundClassifierRunning,
  generationStore,
  isForegroundGenerating,
  isUserEditBlocked,
  type RunState,
  type TxState,
} from './generation'

function run(id: string, kind = 'synthetic'): RunState {
  return {
    runId: id,
    kind,
    gateBehavior: 'no-gate',
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

describe('isUserEditBlocked', () => {
  it('blocks only when a hard-gate run is in flight', () => {
    const mk = (kind: string, gate: 'hard-gate' | 'no-gate') => ({
      ...run(kind),
      gateBehavior: gate,
    })
    const tx = (runs: ReturnType<typeof mk>[], reversalInProgress = false): TxState => ({
      runs: new Map(runs.map((r) => [r.runId, r])),
      reversalInProgress,
      pendingTurns: new Set(),
    })
    expect(isUserEditBlocked(tx([]))).toBe(false)
    expect(isUserEditBlocked(tx([mk('bg', 'no-gate')]))).toBe(false)
    expect(isUserEditBlocked(tx([mk('bg', 'no-gate'), mk('fg', 'hard-gate')]))).toBe(true)
    expect(isUserEditBlocked(tx([], true))).toBe(true)
  })

  // generation-pipeline.md → No-gate write phase: a reversal opened between a Send and its run's
  // registration would have the turn's queued user_action refused.
  it('blocks while a turn is pending, on any branch', () => {
    const blocked = (pendingTurns: TxState['pendingTurns']) =>
      isUserEditBlocked({ runs: new Map(), reversalInProgress: false, pendingTurns })
    expect(blocked(new Set([{ branchId: 'b2' }]))).toBe(true)
    expect(blocked(new Set())).toBe(false)
  })
})

describe('pending turns', () => {
  beforeEach(() => generationStore.__reset())

  const pending = () => [...generationStore.getTxState().pendingTurns].map((t) => t.branchId)

  // Holds the bracket's body open, so a test can end the mark early or settle the body.
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
    await turn.settle()
    expect(calls).toBe(1)
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
  beforeEach(() => generationStore.__reset())

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
  beforeEach(() => generationStore.__reset())

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

  it('bumps by one on abortRun', () => {
    generationStore.startRun(run('run_1'))
    generationStore.abortRun('run_1')
    expect(generationStore.getSettleCount()).toBe(1)
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
  beforeEach(() => generationStore.__reset())

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

describe('awaitRunTerminal', () => {
  function runFor(kind: string, branchId = 'branch_1') {
    let resolveTerminal!: () => void
    const terminal = new Promise<void>((r) => {
      resolveTerminal = r
    })
    return {
      runId: `run_${kind}_${branchId}`,
      kind,
      gateBehavior: 'no-gate' as const,
      actionId: 'act_1',
      storyId: 'story_1',
      branchId,
      abortController: new AbortController(),
      currentPhase: '',
      intermediates: {},
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
