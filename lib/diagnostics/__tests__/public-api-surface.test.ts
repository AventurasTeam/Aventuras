import { describe, expect, it } from 'vitest'

// Guards the 1.7a diagnostics-ownership rework: the persisted toggle moved to
// lib/actions/settings and the in-store hydration hook was deleted, so neither
// may reappear on the lib/diagnostics public surface. Dynamic import keeps the
// whole-namespace read without a (banned) wildcard import specifier.
describe('lib/diagnostics public-API surface', () => {
  it('omits the relocated / deleted diagnostics-toggle symbols', async () => {
    const diagnostics = await import('@/lib/diagnostics')
    expect('setDiagnosticsEnabled' in diagnostics).toBe(false)
    expect('setDebugLevelEnabled' in diagnostics).toBe(false)
    expect('useDiagnosticsHydration' in diagnostics).toBe(false)
    expect('hydrateDiagnostics' in diagnostics).toBe(false)
  })

  it('still exposes the injected-gate + buffer infrastructure surface', async () => {
    const diagnostics = await import('@/lib/diagnostics')
    expect(typeof diagnostics.configureDiagnosticsGate).toBe('function')
    expect(typeof diagnostics.clearBuffers).toBe('function')
    expect(typeof diagnostics.logger).toBe('object')
  })
})
