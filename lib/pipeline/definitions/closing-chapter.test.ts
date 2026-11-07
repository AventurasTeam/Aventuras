import { describe, expect, it } from 'vitest'

import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import type { RunState, TxState } from '@/lib/stores'

import { closingChapterId } from './closing-chapter'
import { CLOSE_RANGE_INTERMEDIATE_KEY, type CloseRange } from './intermediates'

const BRANCH = 'br_1'
const RANGE: CloseRange = { chapterId: 'chap_new', startEntryId: 'se_1', endEntryId: 'se_9' }

function run(kind: string, overrides: Partial<RunState> = {}): RunState {
  return {
    runId: `run_${kind}`,
    kind,
    gateBehavior: 'hard-gate',
    interruptible: null,
    beforeTurn: false,
    actionId: `act_${kind}`,
    storyId: 'story_1',
    branchId: BRANCH,
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
    ...overrides,
  }
}

function txState(...runs: RunState[]): TxState {
  return {
    runs: new Map(runs.map((r) => [r.runId, r])),
    reversalInProgress: false,
    pendingTurns: new Set(),
    deferred: new Map(),
    pendingClose: new Map(),
  }
}

const parked = { [CLOSE_RANGE_INTERMEDIATE_KEY]: RANGE }

describe('closingChapterId', () => {
  it('names the chapter a close on the branch is writing, from its parked range', () => {
    const close = run(CHAPTER_CLOSE_KIND, { intermediates: parked })
    expect(closingChapterId(txState(close), BRANCH)).toBe('chap_new')
  })

  it('finds the close beside another run on the branch', () => {
    const pass = run(PERIODIC_CLASSIFIER_KIND)
    const close = run(CHAPTER_CLOSE_KIND, { intermediates: parked })
    expect(closingChapterId(txState(pass, close), BRANCH)).toBe('chap_new')
  })

  it('is null before the close has parked its range', () => {
    expect(closingChapterId(txState(run(CHAPTER_CLOSE_KIND)), BRANCH)).toBeNull()
  })

  it('is null for a close on another branch', () => {
    const close = run(CHAPTER_CLOSE_KIND, { branchId: 'br_2', intermediates: parked })
    expect(closingChapterId(txState(close), BRANCH)).toBeNull()
  })

  it('is null for a run of another kind, even one holding a range under the key', () => {
    const pass = run(PERIODIC_CLASSIFIER_KIND, { intermediates: parked })
    expect(closingChapterId(txState(pass), BRANCH)).toBeNull()
    expect(closingChapterId(txState(), BRANCH)).toBeNull()
  })
})
