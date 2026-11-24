import { describe, expect, expectTypeOf, it } from 'vitest'

import type { SwitchBranchResult } from '@/lib/actions'
import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import type { RunState, TxState } from '@/lib/stores'

import { switchGateReason, switchResultNotice, type SwitchLanding } from './switch-result-notice'

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

function landing(over: Partial<SwitchLanding> = {}): SwitchLanding {
  return {
    txState: txState([]),
    storyId: 'story-1',
    fromBranchId: 'branch-1',
    turnBodyActive: false,
    ...over,
  }
}

const CLOSING = landing({ txState: txState([closeRun('story-1')]) })

describe('switchResultNotice', () => {
  it.each<[string, SwitchBranchResult]>([
    ['a switch that landed', { status: 'ok' }],
    ['a switch the user abandoned by leaving', { status: 'abandoned' }],
    ['a press while another switch runs', { status: 'refused', code: 'running' }],
  ])('posts nothing for %s, even while the gate is closed', (_name, result) => {
    expect(switchResultNotice(result, CLOSING)).toBeNull()
  })

  it.each<[string, SwitchBranchResult]>([
    ['the closed gate', { status: 'refused', code: 'gate' }],
    ['a turn body still active on the branch left', { status: 'refused', code: 'turn-body' }],
  ])("names the gate's reason for a refusal by %s", (_name, result) => {
    expect(switchResultNotice(result, CLOSING)).toStrictEqual({
      kind: 'info',
      message: 'Chapter close in progress. Cancel to edit.',
    })
  })

  it.each<[string, SwitchBranchResult]>([
    ['a branch missing from the story', { status: 'refused', code: 'missing' }],
    ['a load that failed', { status: 'failed', code: 'load' }],
    ['a stories re-read that failed', { status: 'failed', code: 'stories-reread' }],
    ['a stack reset that did not take', { status: 'failed', code: 'navigation-blocked' }],
  ])('reports %s as a failed switch', (_name, result) => {
    expect(switchResultNotice(result, landing())).toStrictEqual({
      kind: 'error',
      message: "Couldn't switch branches.",
    })
  })

  it.each<[string, SwitchBranchResult]>([
    ['a branch missing from the story', { status: 'refused', code: 'missing' }],
    ['a load that failed', { status: 'failed', code: 'load' }],
    ['a stories re-read that failed', { status: 'failed', code: 'stories-reread' }],
  ])('reports %s as a failed switch while the story is busy', (_name, result) => {
    expect(switchResultNotice(result, CLOSING)).toStrictEqual({
      kind: 'error',
      message: "Couldn't switch branches.",
    })
  })

  it("names the gate's reason for a reset a run that started during the reads blocked", () => {
    expect(
      switchResultNotice({ status: 'failed', code: 'navigation-blocked' }, CLOSING),
    ).toStrictEqual({ kind: 'info', message: 'Chapter close in progress. Cancel to edit.' })
  })

  it("names the gate's reason for a reset a turn body on the branch left blocked", () => {
    expect(
      switchResultNotice(
        { status: 'failed', code: 'navigation-blocked' },
        landing({ turnBodyActive: true }),
      ),
    ).toStrictEqual({ kind: 'info', message: 'Generation is in flight. Cancel to edit.' })
  })

  it('names the gate for a reset a turn queued on the branch left blocked, not one elsewhere', () => {
    const queued = (branchId: string): SwitchLanding =>
      landing({ txState: { ...txState([]), pendingTurns: new Set([{ branchId }]) } })
    const blocked = { status: 'failed', code: 'navigation-blocked' } as const
    expect(switchResultNotice(blocked, queued('branch-1'))).toStrictEqual({
      kind: 'info',
      message: 'Generation is in flight. Cancel to edit.',
    })
    expect(switchResultNotice(blocked, queued('branch-2'))).toStrictEqual({
      kind: 'error',
      message: "Couldn't switch branches.",
    })
  })

  it("reports a blocked reset as a failed switch while only another story's run is in flight", () => {
    expect(
      switchResultNotice(
        { status: 'failed', code: 'navigation-blocked' },
        landing({ txState: txState([closeRun('story-2')]) }),
      ),
    ).toStrictEqual({ kind: 'error', message: "Couldn't switch branches." })
  })
})

describe('switchGateReason', () => {
  it("names the run that holds the story's gate", () => {
    expect(switchGateReason(txState([closeRun('story-1')]), 'story-1')).toBe(
      'Chapter close in progress. Cancel to edit.',
    )
  })

  it('never names a restart hold, which refuses no switch', () => {
    expect(switchGateReason(txState([], ['branch-1']), 'story-1')).toBe(
      'Generation is in flight. Cancel to edit.',
    )
  })

  it("ignores another story's run", () => {
    expect(switchGateReason(txState([closeRun('story-2')]), 'story-1')).toBe(
      'Generation is in flight. Cancel to edit.',
    )
  })

  it('takes a story, since a switch always has one', () => {
    expectTypeOf(switchGateReason).parameter(1).toEqualTypeOf<string>()
    expectTypeOf(switchGateReason).returns.toEqualTypeOf<string>()
  })
})
