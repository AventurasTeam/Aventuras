import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { __resetDiagnosticsGate, configureDiagnosticsGate } from './gate'
import { diagnosticsStore } from './store'
import { turnCaptureSink } from './turn-capture-sink'

beforeEach(() => __resetDiagnosticsGate())
afterEach(() => diagnosticsStore.getState().__reset())

function enable() {
  configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
}

describe('turnCaptureSink', () => {
  it('begins, appends phase events, finalizes', () => {
    enable()
    turnCaptureSink.beginTurn({ actionId: 'act_1', branchId: 'b1' })
    turnCaptureSink.appendPhaseEvent('act_1', { phase: 'synthetic', kind: 'enter', at: 1 })
    turnCaptureSink.appendPhaseEvent('act_1', {
      phase: 'synthetic',
      kind: 'exit',
      at: 2,
      durationMs: 1,
    })
    turnCaptureSink.endTurn('act_1', 'completed')
    const [t] = diagnosticsStore.getState().turnCaptures
    expect(t.outcome).toBe('completed')
    expect(t.phaseEvents).toHaveLength(2)
    expect(t.endedAt).toBeDefined()
  })

  it('evicts the oldest FINALIZED turn at cap, protecting in-flight', () => {
    enable()
    // 100 finalized + push beyond, but keep two in-flight in the oldest slots
    turnCaptureSink.beginTurn({ actionId: 'inflight_a', branchId: 'b1' }) // never ended
    turnCaptureSink.beginTurn({ actionId: 'inflight_b', branchId: 'b1' }) // never ended
    for (let i = 0; i < 98; i++) {
      turnCaptureSink.beginTurn({ actionId: `done_${i}`, branchId: 'b1' })
      turnCaptureSink.endTurn(`done_${i}`, 'completed')
    }
    // buffer now at 100. One more finalized turn forces an eviction.
    turnCaptureSink.beginTurn({ actionId: 'done_new', branchId: 'b1' })
    turnCaptureSink.endTurn('done_new', 'completed')

    const ids = diagnosticsStore.getState().turnCaptures.map((t) => t.actionId)
    expect(ids).toContain('inflight_a') // protected
    expect(ids).toContain('inflight_b') // protected
    expect(ids).not.toContain('done_0') // oldest finalized evicted
    expect(ids).toContain('done_new')
    expect(ids.length).toBe(100)
  })
})
