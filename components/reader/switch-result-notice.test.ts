import { describe, expect, it } from 'vitest'

import type { SwitchBranchResult } from '@/lib/actions'
import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import type { RunState, TxState } from '@/lib/stores'

import { switchGateReason, switchResultNotice } from './switch-result-notice'

const GATE_REASON = 'Chapter close in progress. Cancel to edit.'

describe('switchResultNotice', () => {
  it.each<[string, SwitchBranchResult]>([
    ['a switch that landed', { status: 'ok' }],
    ['a switch the user abandoned by leaving', { status: 'abandoned' }],
    ['a press while another switch runs', { status: 'refused', code: 'running' }],
  ])('posts nothing for %s', (_name, result) => {
    expect(switchResultNotice(result, GATE_REASON)).toBeNull()
  })

  it.each<[string, SwitchBranchResult]>([
    ['the closed gate', { status: 'refused', code: 'gate' }],
    ['a turn body still active on the branch left', { status: 'refused', code: 'turn-body' }],
  ])("names the gate's reason for a refusal by %s", (_name, result) => {
    expect(switchResultNotice(result, GATE_REASON)).toStrictEqual({
      kind: 'info',
      message: GATE_REASON,
    })
  })

  it.each<[string, SwitchBranchResult]>([
    ['a branch missing from the story', { status: 'refused', code: 'missing' }],
    ['a load that failed', { status: 'failed', code: 'load' }],
    ['a stories re-read that failed', { status: 'failed', code: 'stories-reread' }],
    ['a stack reset that did not take', { status: 'failed', code: 'navigation-blocked' }],
  ])('reports %s as a failed switch', (_name, result) => {
    expect(switchResultNotice(result, GATE_REASON)).toStrictEqual({
      kind: 'error',
      message: "Couldn't switch branches.",
    })
  })
})

function closeRun(storyId: string): RunState {
  return {
    runId: `run-close-${storyId}`,
    kind: CHAPTER_CLOSE_KIND,
    gateBehavior: 'hard-gate',
    interruptible: 'close',
    beforeTurn: false,
    actionId: 'action-close',
    storyId,
    branchId: 'branch-1',
    abortController: new AbortController(),
    currentPhase: 'running',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  }
}

function txState(runs: RunState[], heldBranchIds: string[] = []): TxState {
  return {
    runs: new Map(runs.map((run) => [run.runId, run])),
    reversalInProgress: false,
    pendingTurns: new Set(),
    deferred: new Map(),
    pendingClose: new Map(),
    pendingRerun: new Map(),
    heldBranches: new Map(heldBranchIds.map((id) => [id, { storyId: 'story-1' }])),
  }
}

describe('switchGateReason', () => {
  it("names the run that holds the story's gate", () => {
    expect(switchGateReason(txState([closeRun('story-1')]), 'story-1')).toBe(GATE_REASON)
  })

  it('never names a re-run hold, which refuses no switch', () => {
    expect(switchGateReason(txState([], ['branch-1']), 'story-1')).toBe(
      'Generation is in flight. Cancel to edit.',
    )
  })

  it("ignores another story's run", () => {
    expect(switchGateReason(txState([closeRun('story-2')]), 'story-1')).toBe(
      'Generation is in flight. Cancel to edit.',
    )
  })
})
