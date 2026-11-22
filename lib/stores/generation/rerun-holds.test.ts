import { describe, expect, it } from 'vitest'

import type { RunState, TxState } from './generation'
import { refreshHeldByRerun, rerunHoldsReversal } from './rerun-holds'

function run(id: string, over: Partial<RunState> = {}): RunState {
  return {
    runId: id,
    kind: 'chapter-close',
    gateBehavior: 'hard-gate',
    interruptible: 'close',
    beforeTurn: false,
    actionId: `act_${id}`,
    storyId: 's1',
    branchId: 'b1',
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
    ...over,
  }
}

function tx(runs: RunState[], pendingRerun: readonly string[] = []): TxState {
  return {
    runs: new Map(runs.map((r) => [r.runId, r])),
    reversalInProgress: false,
    pendingTurns: new Set(),
    deferred: new Map(),
    pendingClose: new Map(),
    pendingRerun: new Map(pendingRerun.map((branchId) => [branchId, { chapterId: 'chap_1' }])),
    heldBranches: new Map(),
  }
}

const RERUN = run('run_rerun', { interruptible: 'rerun' })
const RERUN_B2 = run('run_rerun_b2', { interruptible: 'rerun', branchId: 'b2' })
const CLOSE = run('run_close')
const PASS = run('run_pass', { kind: 'periodic-classifier', interruptible: 'pass' })
const STAMPED = { chapterId: 'chap_1' }
const OPEN_REGION = { chapterId: null }

// chapter-close.md → Re-running a close, Head reversals (AC 22).
describe('rerunHoldsReversal', () => {
  it.each<[string, RunState[], { chapterId: string | null }, boolean]>([
    ['a stamped entry under a re-run on the branch', [RERUN], STAMPED, true],
    ['an open-region entry under a re-run on the branch', [RERUN], OPEN_REGION, false],
    ['a stamped entry under a close', [CLOSE], STAMPED, false],
    ['a stamped entry under a pass', [PASS], STAMPED, false],
    ['a stamped entry under a re-run on another branch', [RERUN_B2], STAMPED, false],
    ['a stamped entry with nothing running', [], STAMPED, false],
  ])('%s', (_label, runs, target, held) => {
    expect(rerunHoldsReversal(tx(runs), 'b1', target)).toBe(held)
  })
})

describe('refreshHeldByRerun', () => {
  it.each<[string, RunState[], readonly string[], boolean]>([
    ["the re-run's own run", [RERUN], ['b1'], true],
    ["the re-run chain's catch-up pass", [PASS], ['b1'], true],
    ['a close with no record', [CLOSE], [], false],
    ['a pass with no record', [PASS], [], false],
    ['a re-run on another branch', [RERUN_B2], ['b2'], false],
  ])('%s', (_label, runs, held, expected) => {
    expect(refreshHeldByRerun(tx(runs, held), 'b1')).toBe(expected)
  })
})
