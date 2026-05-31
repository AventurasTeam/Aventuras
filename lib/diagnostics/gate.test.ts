import { beforeEach, describe, expect, it } from 'vitest'

import {
  __resetDiagnosticsGate,
  configureDiagnosticsGate,
  isDiagnosticsDebugEnabled,
  isDiagnosticsEnabled,
} from './gate'

beforeEach(() => __resetDiagnosticsGate())

describe('diagnostics gate', () => {
  it('defaults to off before configuration', () => {
    expect(isDiagnosticsEnabled()).toBe(false)
    expect(isDiagnosticsDebugEnabled()).toBe(false)
  })

  it('reads the configured thunks live, not a captured value', () => {
    let enabled = false
    configureDiagnosticsGate({ isEnabled: () => enabled, isDebugEnabled: () => false })
    expect(isDiagnosticsEnabled()).toBe(false)
    enabled = true
    expect(isDiagnosticsEnabled()).toBe(true)
  })

  it('debug thunk is independent of the enabled thunk', () => {
    configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
    expect(isDiagnosticsDebugEnabled()).toBe(true)
  })
})
