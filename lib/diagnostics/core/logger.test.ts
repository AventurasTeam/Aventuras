import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetDiagnosticsGate, configureDiagnosticsGate } from './gate'
import { logger } from './logger'
import { diagnosticsStore } from './store'

describe('logger', () => {
  beforeEach(() => {
    diagnosticsStore.getState().__reset()
    __resetDiagnosticsGate()
  })
  afterEach(() => vi.restoreAllMocks())

  it('writes a LogEntry and mirrors to console when master is ON', () => {
    configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logger.warn('provider.retry_succeeded', { attempt: 2 })
    const entries = diagnosticsStore.getState().logEntries
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      level: 'warn',
      kind: 'provider.retry_succeeded',
      fields: { attempt: 2 },
    })
    expect(typeof entries[0].id).toBe('string')
    expect(entries[0].actionId).toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('no-ops at every level when master is OFF', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logger.error('pipeline.run_aborted', {})
    logger.warn('pipeline.recovered', {})
    expect(diagnosticsStore.getState().logEntries).toHaveLength(0)
    expect(errSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('debug no-ops when debug_level is OFF, but warn/error emit', () => {
    configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => false })
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    logger.debug('pipeline.recovered', {})
    expect(diagnosticsStore.getState().logEntries).toHaveLength(0)
    logger.warn('pipeline.recovered', {})
    expect(diagnosticsStore.getState().logEntries).toHaveLength(1)
  })

  it('debug emits when both master and debug_level are ON', () => {
    configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    logger.debug('pipeline.recovered', { detail: 1 })
    expect(diagnosticsStore.getState().logEntries).toHaveLength(1)
  })

  it('warns on a non-snake_case event name in a dev build', () => {
    configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logger.warn('pipeline.phaseFailed', {}) // camelCase event name
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('non-snake_case'))).toBe(true)
    expect(diagnosticsStore.getState().logEntries).toHaveLength(1)
  })

  it('ring buffer caps at 500 and evicts the first 100 when 600 emit through the logger', () => {
    configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let i = 0; i < 600; i++) logger.warn('pipeline.recovered', { i })
    const { logEntries } = diagnosticsStore.getState()
    expect(logEntries).toHaveLength(500)
    expect(logEntries[0].fields.i).toBe(100) // first 100 emissions evicted
    expect(logEntries[499].fields.i).toBe(599)
  })
})
