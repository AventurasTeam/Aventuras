import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ConcurrencyPolicy } from '@/lib/pipeline'
import type { RunState } from '@/lib/stores'

import { checkConcurrencyContract } from './concurrency'
import { definePipeline } from '../authoring/define'
import { __resetRegistry } from '../authoring/registry'
import type { PhaseResult } from '../types'

async function* ok(): AsyncGenerator<never, PhaseResult> {
  return { status: 'completed' }
}

function define(kind: string, policy: ConcurrencyPolicy): void {
  definePipeline({
    kind,
    phases: [{ name: 'p', run: ok }],
    affordance: 'invisible',
    gateBehavior: 'no-gate',
    concurrencyPolicy: policy,
  })
}

function runState(kind: string): RunState {
  return {
    runId: `r_${kind}`,
    kind,
    gateBehavior: 'no-gate',
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

  it('blocks a periodic-classifier start while a reversal is in progress', () => {
    define('periodic-classifier', { blockedBy: ['periodic-classifier'] })
    expect(checkConcurrencyContract('periodic-classifier', runs(), true)).toEqual({
      kind: 'blocked',
      by: 'reversal',
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
