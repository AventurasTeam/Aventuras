import { describe, expect, it } from 'vitest'

import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { PER_TURN_KIND } from '@/lib/pipeline'
import type { RunState, TxState } from '@/lib/stores'

import { suggestionRefreshBlocked, suggestionRefreshHoldReason } from './suggestion-refresh-gate'

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

function tx(fields: Partial<TxState> = {}, ...runs: RunState[]): TxState {
  return {
    runs: new Map(runs.map((r) => [r.runId, r])),
    reversalInProgress: false,
    pendingTurns: new Set(),
    deferred: new Map(),
    pendingClose: new Map(),
    pendingRerun: new Map(),
    heldBranches: new Map(),
    ...fields,
  }
}

const PASS = run({ runId: 'run_pass', kind: PERIODIC_CLASSIFIER_KIND, interruptible: 'pass' })
const TURN = run({ runId: 'run_turn', kind: PER_TURN_KIND })
const CLOSE = run({ runId: 'run_close', kind: CHAPTER_CLOSE_KIND, interruptible: 'close' })
const RERUN = run({ runId: 'run_rerun', kind: CHAPTER_CLOSE_KIND, interruptible: 'rerun' })
// pendingRerun holds the branch for the re-run's whole chain, its catch-up pass included.
const RERUN_CHAIN: Partial<TxState> = {
  pendingRerun: new Map([['br_1', { chapterId: 'chap_2' }]]),
}
const RERUN_REASON = "Re-running the chapter's close. Cancel to edit."

describe('suggestionRefreshBlocked', () => {
  it('lets a refresh start on an idle branch', () => {
    expect(suggestionRefreshBlocked(tx(), 'br_1', false)).toBe(false)
  })

  // The strip stays live through a pass, as the head reversals do.
  it('lets a refresh start beside a pass on the branch', () => {
    expect(suggestionRefreshBlocked(tx({}, PASS), 'br_1', false)).toBe(false)
  })

  // The orchestrator admits a refresh during a prose reversal; only this guard refuses it.
  it('refuses while a prose reversal runs', () => {
    expect(suggestionRefreshBlocked(tx({ reversalInProgress: true }), 'br_1', false)).toBe(true)
  })

  it('refuses while a turn is pending', () => {
    const pending = tx({ pendingTurns: new Set([{ branchId: 'br_1' }]) })
    expect(suggestionRefreshBlocked(pending, 'br_1', false)).toBe(true)
  })

  it('refuses while a turn runs', () => {
    expect(suggestionRefreshBlocked(tx({}, TURN), 'br_1', false)).toBe(true)
  })

  // The strip re-renders disabled a frame after the tap that started a dispatch.
  it("refuses while the host's own dispatch is in flight", () => {
    expect(suggestionRefreshBlocked(tx(), 'br_1', true)).toBe(true)
  })

  // A refresh's chip delta would sit above the re-run's floor, and its CTRL-Z would undo the close.
  it("refuses through a re-run's chain on the branch, its catch-up pass included", () => {
    expect(suggestionRefreshBlocked(tx(RERUN_CHAIN, RERUN), 'br_1', false)).toBe(true)
    expect(suggestionRefreshBlocked(tx(RERUN_CHAIN, PASS), 'br_1', false)).toBe(true)
  })

  it("lets a refresh start beside a close, or beside another branch's re-run", () => {
    expect(suggestionRefreshBlocked(tx({}, CLOSE), 'br_1', false)).toBe(false)
    expect(suggestionRefreshBlocked(tx(RERUN_CHAIN), 'br_2', false)).toBe(false)
  })
})

describe('suggestionRefreshHoldReason', () => {
  it('names the re-run through its chain, its catch-up pass included', () => {
    expect(suggestionRefreshHoldReason(tx(RERUN_CHAIN, RERUN), 'br_1')).toBe(RERUN_REASON)
    expect(suggestionRefreshHoldReason(tx(RERUN_CHAIN, PASS), 'br_1')).toBe(RERUN_REASON)
  })

  it('holds nothing during a close or a pass, or for another branch', () => {
    expect(suggestionRefreshHoldReason(tx({}, CLOSE), 'br_1')).toBeUndefined()
    expect(suggestionRefreshHoldReason(tx({}, PASS), 'br_1')).toBeUndefined()
    expect(suggestionRefreshHoldReason(tx(RERUN_CHAIN), 'br_2')).toBeUndefined()
  })
})
