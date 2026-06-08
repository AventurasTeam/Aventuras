import { beforeEach, describe, expect, it } from 'vitest'

import { clearBuffers, diagnosticsStore, getDiagnosticsSnapshot } from './store'
import type { HttpCall, LogEntry, TurnCapture } from '../types'

beforeEach(() => diagnosticsStore.getState().__reset())

const log: LogEntry = {
  id: 'l1',
  emittedAt: 1,
  level: 'warn',
  kind: 'pipeline.run_aborted',
  fields: {},
}
const call = { id: 'c1', startedAt: 1, method: 'POST', url: 'x', requestHeaders: {} } as HttpCall
const turn = {
  actionId: 'a1',
  kind: 'per-turn',
  branchId: 'b1',
  startedAt: 1,
  phaseEvents: [],
} as TurnCapture

function entry(i: number): LogEntry {
  return { id: String(i), emittedAt: i, level: 'warn', kind: 'pipeline.run_aborted', fields: { i } }
}

describe('diagnostics store buffers', () => {
  it('pushLog appends entries', () => {
    diagnosticsStore.getState().pushLog(log)
    expect(getDiagnosticsSnapshot().logEntries).toHaveLength(1)
  })

  it('evicts logEntries FIFO at cap 500', () => {
    for (let i = 0; i < 501; i++) diagnosticsStore.getState().pushLog(entry(i))
    const { logEntries } = getDiagnosticsSnapshot()
    expect(logEntries).toHaveLength(500)
    expect(logEntries[0].id).toBe('1') // entry 0 evicted
    expect(logEntries[499].id).toBe('500')
  })

  it('clearBuffers empties all three slices', () => {
    diagnosticsStore.getState().pushLog(log)
    diagnosticsStore.setState({ httpCalls: [call], turnCaptures: [turn] })
    clearBuffers()
    const after = getDiagnosticsSnapshot()
    expect(after.logEntries).toEqual([])
    expect(after.httpCalls).toEqual([])
    expect(after.turnCaptures).toEqual([])
  })
})
