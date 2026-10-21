import { describe, expect, it } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { PER_TURN_KIND } from '@/lib/pipeline'
import type { RunState, TxState } from '@/lib/stores'

import { suggestionRefreshBlocked } from './suggestion-refresh-gate'

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
    ...fields,
  }
}

const PASS = run({ runId: 'run_pass', kind: PERIODIC_CLASSIFIER_KIND, interruptible: 'pass' })
const TURN = run({ runId: 'run_turn', kind: PER_TURN_KIND })

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
})
