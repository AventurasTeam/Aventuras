import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { PER_TURN_KIND, SUGGESTION_REFRESH_KIND } from '@/lib/pipeline'
import type { RunState, TxState } from '@/lib/stores'

import { cancelSendRun, findSendRun } from './send-run'

const stores = vi.hoisted(() => ({
  interruptMemoryRuns: vi.fn<(branchId: string) => Promise<void>>(),
  awaitRunTerminal:
    vi.fn<(kind: string, branchId: string, disposition: 'finish' | 'cancel') => Promise<void>>(),
}))

vi.mock('@/lib/stores', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  interruptMemoryRuns: stores.interruptMemoryRuns,
  awaitRunTerminal: stores.awaitRunTerminal,
}))

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
    interruptible: false,
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

const TURN = run({ runId: 'run_turn', kind: PER_TURN_KIND })
const CHAINED_PASS = run({ runId: 'run_pass', kind: PERIODIC_CLASSIFIER_KIND, interruptible: true })
const DEFERRED_PASS = run({
  runId: 'run_deferred',
  kind: PERIODIC_CLASSIFIER_KIND,
  interruptible: true,
  beforeTurn: true,
})
const REFRESH = run({ runId: 'run_refresh', kind: SUGGESTION_REFRESH_KIND })

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

describe('cancelSendRun', () => {
  beforeEach(() => {
    stores.interruptMemoryRuns.mockReset()
    stores.interruptMemoryRuns.mockResolvedValue(undefined)
    stores.awaitRunTerminal.mockReset()
    stores.awaitRunTerminal.mockResolvedValue(undefined)
  })

  it("interrupts Send's deferred pass", async () => {
    await cancelSendRun(DEFERRED_PASS)
    expect(stores.interruptMemoryRuns).toHaveBeenCalledWith('br_1')
    expect(stores.awaitRunTerminal).not.toHaveBeenCalled()
  })

  // The pill's Cancel reaches a chained pass through the same call.
  it('interrupts a chained pass', async () => {
    await cancelSendRun(CHAINED_PASS)
    expect(stores.interruptMemoryRuns).toHaveBeenCalledWith('br_1')
    expect(stores.awaitRunTerminal).not.toHaveBeenCalled()
  })

  it('cancels a turn through its terminal', async () => {
    await cancelSendRun(TURN)
    expect(stores.awaitRunTerminal).toHaveBeenCalledWith(PER_TURN_KIND, 'br_1', 'cancel')
    expect(stores.interruptMemoryRuns).not.toHaveBeenCalled()
  })
})
