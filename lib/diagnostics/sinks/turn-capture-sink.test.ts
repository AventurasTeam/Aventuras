import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { turnCaptureSink } from './turn-capture-sink'
import { __resetDiagnosticsGate, configureDiagnosticsGate } from '../core/gate'
import { diagnosticsStore } from '../core/store'

beforeEach(() => __resetDiagnosticsGate())
afterEach(() => diagnosticsStore.getState().__reset())

function enable() {
  configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
}

describe('turnCaptureSink', () => {
  it('begins, appends phase events, finalizes', () => {
    enable()
    turnCaptureSink.beginTurn({ actionId: 'act_1', kind: 'per-turn', branchId: 'b1' })
    turnCaptureSink.appendPhaseEvent('act_1', { phase: 'synthetic', kind: 'enter', at: 1 })
    turnCaptureSink.appendPhaseEvent('act_1', {
      phase: 'synthetic',
      kind: 'exit',
      at: 2,
      durationMs: 1,
    })
    turnCaptureSink.endTurn('act_1', 'completed')
    const [t] = diagnosticsStore.getState().turnCaptures
    expect(t.kind).toBe('per-turn')
    expect(t.outcome).toBe('completed')
    expect(t.phaseEvents).toHaveLength(2)
    expect(t.endedAt).toBeDefined()
  })

  it('recordTargetEntry sets both targetEntryId and anchorEntryId', () => {
    enable()
    turnCaptureSink.beginTurn({ actionId: 'act_t', kind: 'per-turn', branchId: 'b1' })
    turnCaptureSink.recordTargetEntry('act_t', 'entry_9')
    const [t] = diagnosticsStore.getState().turnCaptures
    expect(t.targetEntryId).toBe('entry_9')
    expect(t.anchorEntryId).toBe('entry_9')
  })

  it('beginTurn carries a passed anchorEntryId for a background run', () => {
    enable()
    turnCaptureSink.beginTurn({
      actionId: 'act_bg',
      kind: 'periodic-classifier',
      branchId: 'b1',
      anchorEntryId: 'head_entry',
    })
    const [t] = diagnosticsStore.getState().turnCaptures
    expect(t.anchorEntryId).toBe('head_entry')
    expect(t.targetEntryId).toBeUndefined()
  })

  it('evicts the oldest FINALIZED turn at cap, protecting in-flight', () => {
    enable()
    // 100 finalized + push beyond, but keep two in-flight in the oldest slots
    turnCaptureSink.beginTurn({ actionId: 'inflight_a', kind: 'per-turn', branchId: 'b1' }) // never ended
    turnCaptureSink.beginTurn({ actionId: 'inflight_b', kind: 'per-turn', branchId: 'b1' }) // never ended
    for (let i = 0; i < 98; i++) {
      turnCaptureSink.beginTurn({ actionId: `done_${i}`, kind: 'per-turn', branchId: 'b1' })
      turnCaptureSink.endTurn(`done_${i}`, 'completed')
    }
    // buffer now at 100. One more finalized turn forces an eviction.
    turnCaptureSink.beginTurn({ actionId: 'done_new', kind: 'per-turn', branchId: 'b1' })
    turnCaptureSink.endTurn('done_new', 'completed')

    const ids = diagnosticsStore.getState().turnCaptures.map((t) => t.actionId)
    expect(ids).toContain('inflight_a') // protected
    expect(ids).toContain('inflight_b') // protected
    expect(ids).not.toContain('done_0') // oldest finalized evicted
    expect(ids).toContain('done_new')
    expect(ids.length).toBe(100)
  })
})
