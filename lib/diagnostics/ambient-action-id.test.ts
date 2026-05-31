import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { clearCurrentActionId, getCurrentActionId, setCurrentActionId } from './ambient-action-id'
import { __resetDiagnosticsGate, configureDiagnosticsGate } from './gate'
import { logger } from './logger'
import { diagnosticsStore } from './store'

beforeEach(() => __resetDiagnosticsGate())
afterEach(() => {
  clearCurrentActionId()
  diagnosticsStore.getState().__reset()
})

describe('ambient actionId', () => {
  it('stamps logger emissions with the current actionId, cleared after', () => {
    configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
    setCurrentActionId('act_42')
    logger.warn('pipeline.test_event', {})
    const entries = diagnosticsStore.getState().logEntries
    expect(entries.at(-1)?.actionId).toBe('act_42')

    clearCurrentActionId()
    logger.warn('pipeline.test_event', {})
    expect(getCurrentActionId()).toBeUndefined()
    expect(diagnosticsStore.getState().logEntries.at(-1)?.actionId).toBeUndefined()
  })
})
