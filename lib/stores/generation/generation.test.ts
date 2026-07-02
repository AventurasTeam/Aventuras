import { beforeEach, describe, expect, it } from 'vitest'

import { generationStore, isUserEditBlocked, type RunState, type TxState } from './generation'

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
    })
    expect(isUserEditBlocked(tx([]))).toBe(false)
    expect(isUserEditBlocked(tx([mk('bg', 'no-gate')]))).toBe(false)
    expect(isUserEditBlocked(tx([mk('bg', 'no-gate'), mk('fg', 'hard-gate')]))).toBe(true)
    expect(isUserEditBlocked(tx([], true))).toBe(true)
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
