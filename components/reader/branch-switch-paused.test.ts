import { describe, expect, it } from 'vitest'

import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import type { RunState, TxState } from '@/lib/stores'

import { branchSwitchPaused } from './branch-switch-paused'

function closeRun(): RunState {
  return {
    runId: 'run-close',
    kind: CHAPTER_CLOSE_KIND,
    gateBehavior: 'hard-gate',
    interruptible: 'close',
    beforeTurn: false,
    actionId: 'action-close',
    storyId: 'story-1',
    branchId: 'branch-1',
    abortController: new AbortController(),
    currentPhase: 'running',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  }
}

function txState(opts: { runs?: RunState[]; heldBranchIds?: string[] } = {}): TxState {
  return {
    runs: new Map((opts.runs ?? []).map((run) => [run.runId, run])),
    reversalInProgress: false,
    pendingTurns: new Set(),
    deferred: new Map(),
    pendingClose: new Map(),
    pendingRerun: new Map(),
    heldBranches: new Map((opts.heldBranchIds ?? []).map((id) => [id, { storyId: 'story-1' }])),
  }
}

describe('branchSwitchPaused', () => {
  it('is live on a branch held until a restart, with no run', () => {
    expect(
      branchSwitchPaused({
        txState: txState({ heldBranchIds: ['branch-1'] }),
        dispatchInFlight: false,
        held: false,
      }),
    ).toBe(false)
  })

  it('pauses while a run holds the gate', () => {
    expect(
      branchSwitchPaused({
        txState: txState({ runs: [closeRun()] }),
        dispatchInFlight: false,
        held: false,
      }),
    ).toBe(true)
  })

  it('pauses while the reader dispatches', () => {
    expect(branchSwitchPaused({ txState: txState(), dispatchInFlight: true, held: false })).toBe(
      true,
    )
  })

  it('pauses while the reader holds its controls for a switch', () => {
    expect(branchSwitchPaused({ txState: txState(), dispatchInFlight: false, held: true })).toBe(
      true,
    )
  })

  it('is live when nothing holds it', () => {
    expect(branchSwitchPaused({ txState: txState(), dispatchInFlight: false, held: false })).toBe(
      false,
    )
  })
})
