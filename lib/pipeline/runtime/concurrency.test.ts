import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import type { ConcurrencyPolicy, Pipeline } from '@/lib/pipeline'
import type { RunState } from '@/lib/stores'

import { checkConcurrencyContract } from './concurrency'
import { definePipeline } from '../authoring/define'
import { __resetRegistry } from '../authoring/registry'
import { SUGGESTION_REFRESH_KIND } from '../definitions/suggestion-refresh'
import type { PhaseResult } from '../types'

async function* ok(): AsyncGenerator<never, PhaseResult> {
  return { status: 'completed' }
}

function define(kind: string, policy: ConcurrencyPolicy, extra: Partial<Pipeline> = {}): void {
  definePipeline({
    kind,
    phases: [{ name: 'p', run: ok }],
    affordance: 'invisible',
    gateBehavior: 'hard-gate',
    concurrencyPolicy: policy,
    ...extra,
  })
}

function runState(kind: string): RunState {
  return {
    runId: `r_${kind}`,
    kind,
    gateBehavior: 'hard-gate',
    interruptible: null,
    beforeTurn: false,
    actionId: 'a',
    storyId: null,
    branchId: 'b',
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  }
}

function runs(...kinds: string[]): Map<string, RunState> {
  return new Map(kinds.map((k) => [`r_${k}`, runState(k)]))
}

describe('checkConcurrencyContract', () => {
  beforeEach(() => __resetRegistry())
  afterEach(() => __resetRegistry())

  it('starts when idle', () => {
    define('per-turn', { blockedBy: ['per-turn'] })
    expect(checkConcurrencyContract('per-turn', runs(), false)).toEqual({ kind: 'start' })
  })

  it('blocks when a blockedBy kind is running', () => {
    define('per-turn', { blockedBy: ['per-turn', 'chapter-close'] })
    define('chapter-close', { blockedBy: [] })
    expect(checkConcurrencyContract('per-turn', runs('chapter-close'), false)).toEqual({
      kind: 'blocked',
      by: 'chapter-close',
    })
  })

  it('starts when running kinds are not in blockedBy', () => {
    define('per-turn', { blockedBy: ['per-turn', 'chapter-close'] })
    define('periodic-classifier', { blockedBy: ['periodic-classifier', 'chapter-close'] })
    expect(checkConcurrencyContract('per-turn', runs('periodic-classifier'), false)).toEqual({
      kind: 'start',
    })
  })

  it('self-blocks when blockedBy includes own kind', () => {
    define('periodic-classifier', { blockedBy: ['periodic-classifier'] })
    expect(
      checkConcurrencyContract('periodic-classifier', runs('periodic-classifier'), false),
    ).toEqual({ kind: 'blocked', by: 'periodic-classifier' })
  })

  // generation-pipeline.md → runPipeline entry algorithm: no pass or close may start between a
  // reversal's interrupt and its sweep.
  it('blocks an interruptible start while a reversal is in progress, and starts it after', () => {
    define('memory-run', { blockedBy: ['memory-run'] }, { interruptible: 'pass' })
    expect(checkConcurrencyContract('memory-run', runs(), true)).toEqual({
      kind: 'blocked',
      by: 'reversal',
    })
    expect(checkConcurrencyContract('memory-run', runs(), false)).toEqual({ kind: 'start' })
  })

  it('checks the reversal before blockedBy', () => {
    define('memory-run', { blockedBy: ['per-turn'] }, { interruptible: 'pass' })
    define('per-turn', {})
    expect(checkConcurrencyContract('memory-run', runs('per-turn'), true)).toEqual({
      kind: 'blocked',
      by: 'reversal',
    })
  })

  it('does not block a suggestion-refresh start while a reversal is in progress', () => {
    define(SUGGESTION_REFRESH_KIND, { blockedBy: [SUGGESTION_REFRESH_KIND] })
    expect(checkConcurrencyContract(SUGGESTION_REFRESH_KIND, runs(), true)).toEqual({
      kind: 'start',
    })
  })

  // The flag, not the kind name, decides: a classifier declared without it is not held back.
  it('does not block a periodic-classifier start that is not interruptible', () => {
    define(PERIODIC_CLASSIFIER_KIND, { blockedBy: [PERIODIC_CLASSIFIER_KIND] })
    expect(checkConcurrencyContract(PERIODIC_CLASSIFIER_KIND, runs(), true)).toEqual({
      kind: 'start',
    })
  })

  it('reversalInProgress does not block other kinds', () => {
    define('per-turn', { blockedBy: ['per-turn'] })
    expect(checkConcurrencyContract('per-turn', runs(), true)).toEqual({ kind: 'start' })
  })

  it('returns yield targets when a running run yieldsTo the incoming kind', () => {
    define('fg', { blockedBy: [] })
    define('bg', { blockedBy: [], yieldsTo: ['fg'] })
    expect(checkConcurrencyContract('fg', runs('bg'), false)).toEqual({
      kind: 'start-after-yields',
      targets: ['r_bg'],
    })
  })
})
