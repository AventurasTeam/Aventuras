import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __resetDiagnosticsGate,
  clearBuffers,
  configureDiagnosticsGate,
  getDiagnosticsSnapshot,
  setHttpCallKnownSecretValues,
} from '@/lib/diagnostics'

import { __resetRejectionHandlerForTest, registerRejectionHandler } from './rejection-handler'

function captureListener(
  addEventListener: ReturnType<typeof vi.fn>,
  eventName: string,
): (ev: unknown) => void {
  const call = addEventListener.mock.calls.find((c) => c[0] === eventName)
  return call?.[1] as (ev: unknown) => void
}

beforeEach(() => {
  __resetRejectionHandlerForTest()
  clearBuffers()
  configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
})

afterEach(() => {
  __resetDiagnosticsGate()
  setHttpCallKnownSecretValues([])
  vi.unstubAllGlobals()
})

describe('registerRejectionHandler', () => {
  it('registers unhandledrejection and rejectionhandled listeners once each', () => {
    const addEventListener = vi.fn()
    registerRejectionHandler({ addEventListener })
    registerRejectionHandler({ addEventListener })
    expect(addEventListener).toHaveBeenCalledTimes(2)
    expect(addEventListener).toHaveBeenCalledWith('unhandledrejection', expect.any(Function))
    expect(addEventListener).toHaveBeenCalledWith('rejectionhandled', expect.any(Function))
  })

  it('logs the stack (not just the message) with a per-event id when the DOM listener fires', () => {
    const addEventListener = vi.fn()
    registerRejectionHandler({ addEventListener })
    captureListener(addEventListener, 'unhandledrejection')({ reason: new Error('boom') })
    const { logEntries } = getDiagnosticsSnapshot()
    expect(logEntries).toHaveLength(1)
    expect(logEntries[0].kind).toBe('app.unhandled_rejection')
    const error = String(logEntries[0].fields.error)
    expect(error).toContain('boom')
    expect(error).toContain('rejection-handler.test.ts')
    expect(logEntries[0].fields.id).toBe(0)
  })

  it('correlates a DOM rejectionhandled retraction to its accusation by promise identity, not the most recent one', () => {
    const addEventListener = vi.fn()
    registerRejectionHandler({ addEventListener })
    const unhandled = captureListener(addEventListener, 'unhandledrejection')
    const handled = captureListener(addEventListener, 'rejectionhandled')
    const promiseA = Promise.resolve()
    const promiseB = Promise.resolve()

    unhandled({ reason: new Error('boom-a'), promise: promiseA })
    const idA = getDiagnosticsSnapshot().logEntries[0].fields.id
    unhandled({ reason: new Error('boom-b'), promise: promiseB })
    const idB = getDiagnosticsSnapshot().logEntries[1].fields.id
    expect(idA).not.toBe(idB)
    clearBuffers()

    handled({ promise: promiseA })
    const { logEntries } = getDiagnosticsSnapshot()
    expect(logEntries).toHaveLength(1)
    expect(logEntries[0].kind).toBe('app.rejection_handled_late')
    expect(logEntries[0].level).toBe('warn')
    expect(logEntries[0].fields.id).toBe(idA)
    expect(logEntries[0].fields.id).not.toBe(idB)
  })

  it('records a DOM retraction even when the diagnostics gate is OFF', () => {
    configureDiagnosticsGate({ isEnabled: () => false, isDebugEnabled: () => false })
    const addEventListener = vi.fn()
    registerRejectionHandler({ addEventListener })
    const unhandled = captureListener(addEventListener, 'unhandledrejection')
    const handled = captureListener(addEventListener, 'rejectionhandled')
    const promise = Promise.resolve()
    unhandled({ reason: new Error('boom'), promise })
    clearBuffers()
    handled({ promise })
    const { logEntries } = getDiagnosticsSnapshot()
    expect(logEntries).toHaveLength(1)
    expect(logEntries[0].kind).toBe('app.rejection_handled_late')
  })

  it('ignores a rejectionhandled event for a promise it never saw an unhandledrejection for', () => {
    const addEventListener = vi.fn()
    registerRejectionHandler({ addEventListener })
    const handled = captureListener(addEventListener, 'rejectionhandled')
    handled({ promise: Promise.resolve() })
    expect(getDiagnosticsSnapshot().logEntries).toHaveLength(0)
  })

  it('stringifies a non-Error rejection reason', () => {
    const addEventListener = vi.fn()
    registerRejectionHandler({ addEventListener })
    captureListener(addEventListener, 'unhandledrejection')({ reason: 'plain string rejection' })
    const { logEntries } = getDiagnosticsSnapshot()
    expect(logEntries[0].fields.error).toBe('plain string rejection')
  })

  it('JSON-stringifies a plain-object rejection reason instead of collapsing to [object Object]', () => {
    const addEventListener = vi.fn()
    registerRejectionHandler({ addEventListener })
    captureListener(addEventListener, 'unhandledrejection')({ reason: { code: 'E_TIMEOUT' } })
    const { logEntries } = getDiagnosticsSnapshot()
    expect(logEntries[0].fields.error).toBe('{"code":"E_TIMEOUT"}')
  })

  it('does not throw and still records an entry for a Symbol rejection reason', () => {
    const addEventListener = vi.fn()
    registerRejectionHandler({ addEventListener })
    const listener = captureListener(addEventListener, 'unhandledrejection')
    expect(() => listener({ reason: Symbol('boom') })).not.toThrow()
    const { logEntries } = getDiagnosticsSnapshot()
    expect(logEntries).toHaveLength(1)
    // The recorded reason, not just that something was recorded: a blank error field is
    // a report nobody can act on, and all four of these cases would still record an entry.
    expect(logEntries[0].fields.error).toBe('Symbol(boom)')
  })

  it('does not throw and still records an entry for a function rejection reason', () => {
    const addEventListener = vi.fn()
    registerRejectionHandler({ addEventListener })
    const listener = captureListener(addEventListener, 'unhandledrejection')
    expect(() => listener({ reason: () => {} })).not.toThrow()
    const { logEntries } = getDiagnosticsSnapshot()
    expect(logEntries).toHaveLength(1)
    expect(String(logEntries[0].fields.error)).toContain('=>')
  })

  it('does not throw and still records an entry for a reason whose property access throws', () => {
    const addEventListener = vi.fn()
    registerRejectionHandler({ addEventListener })
    const listener = captureListener(addEventListener, 'unhandledrejection')
    const poison = new Proxy(
      {},
      {
        get() {
          throw new Error('trap')
        },
      },
    )
    expect(() => listener({ reason: poison })).not.toThrow()
    const { logEntries } = getDiagnosticsSnapshot()
    expect(logEntries).toHaveLength(1)
    // The sentinel, hardcoded: this is the one case that genuinely cannot be
    // stringified, and it must say so rather than record an empty reason.
    expect(logEntries[0].fields.error).toBe('<unreportable rejection reason>')
  })

  it('does not throw and still records an entry for an Error whose .stack is not a string', () => {
    const addEventListener = vi.fn()
    registerRejectionHandler({ addEventListener })
    const listener = captureListener(addEventListener, 'unhandledrejection')
    const err = new Error('boom')
    // @ts-expect-error deliberately breaking the usual string invariant
    err.stack = 404
    expect(() => listener({ reason: err })).not.toThrow()
    const { logEntries } = getDiagnosticsSnapshot()
    expect(logEntries).toHaveLength(1)
    // Falls through to .message when .stack is not a string.
    expect(logEntries[0].fields.error).toBe('boom')
  })

  it('redacts a known secret embedded in a URL within the rejection stack', () => {
    setHttpCallKnownSecretValues(['sk-test-abc'])
    const addEventListener = vi.fn()
    registerRejectionHandler({ addEventListener })
    const err = new Error('fetch failed')
    err.stack = 'Error: fetch failed\n    at https://api.example.test/v1?api_key=sk-test-abc'
    captureListener(addEventListener, 'unhandledrejection')({ reason: err })
    const error = String(getDiagnosticsSnapshot().logEntries[0].fields.error)
    expect(error).not.toContain('sk-test-abc')
    expect(error).toContain('api_key=***')
  })

  it('records via the DOM listener even when the diagnostics gate is OFF', () => {
    configureDiagnosticsGate({ isEnabled: () => false, isDebugEnabled: () => false })
    const addEventListener = vi.fn()
    registerRejectionHandler({ addEventListener })
    captureListener(addEventListener, 'unhandledrejection')({ reason: new Error('boom') })
    const { logEntries } = getDiagnosticsSnapshot()
    expect(logEntries).toHaveLength(1)
    expect(logEntries[0].kind).toBe('app.unhandled_rejection')
  })

  it('falls through to the Hermes tracker when addEventListener is unavailable', () => {
    const enablePromiseRejectionTracker = vi.fn()
    vi.stubGlobal('HermesInternal', { enablePromiseRejectionTracker })
    registerRejectionHandler({})
    expect(enablePromiseRejectionTracker).toHaveBeenCalledTimes(1)
    const options = enablePromiseRejectionTracker.mock.calls[0][0] as {
      allRejections: boolean
      onUnhandled: (id: number, rejection: unknown) => void
    }
    expect(options.allRejections).toBe(true)
    options.onUnhandled(7, new Error('x'))
    const { logEntries } = getDiagnosticsSnapshot()
    expect(logEntries).toHaveLength(1)
    expect(logEntries[0].kind).toBe('app.unhandled_rejection')
    expect(String(logEntries[0].fields.error)).toContain('x')
    expect(logEntries[0].fields.id).toBe(7)
  })

  it('logs a retraction at warn when the Hermes tracker reports a late catch', () => {
    const enablePromiseRejectionTracker = vi.fn()
    vi.stubGlobal('HermesInternal', { enablePromiseRejectionTracker })
    registerRejectionHandler({})
    const options = enablePromiseRejectionTracker.mock.calls[0][0] as {
      onHandled: (id: number) => void
    }
    options.onHandled(7)
    const { logEntries } = getDiagnosticsSnapshot()
    expect(logEntries).toHaveLength(1)
    expect(logEntries[0].kind).toBe('app.rejection_handled_late')
    expect(logEntries[0].level).toBe('warn')
    expect(logEntries[0].fields.id).toBe(7)
  })

  it('records via the Hermes tracker even when the diagnostics gate is OFF', () => {
    configureDiagnosticsGate({ isEnabled: () => false, isDebugEnabled: () => false })
    const enablePromiseRejectionTracker = vi.fn()
    vi.stubGlobal('HermesInternal', { enablePromiseRejectionTracker })
    registerRejectionHandler({})
    const options = enablePromiseRejectionTracker.mock.calls[0][0] as {
      onUnhandled: (id: number, rejection: unknown) => void
    }
    options.onUnhandled(1, new Error('x'))
    const { logEntries } = getDiagnosticsSnapshot()
    expect(logEntries).toHaveLength(1)
    expect(logEntries[0].kind).toBe('app.unhandled_rejection')
  })

  it('skips the Hermes tracker in dev, where RN/Expo already cover it', () => {
    vi.stubGlobal('__DEV__', true)
    const enablePromiseRejectionTracker = vi.fn()
    vi.stubGlobal('HermesInternal', { enablePromiseRejectionTracker })
    registerRejectionHandler({})
    expect(enablePromiseRejectionTracker).not.toHaveBeenCalled()
  })

  it('warns (not debug) when neither seam is available', () => {
    registerRejectionHandler({})
    const { logEntries } = getDiagnosticsSnapshot()
    expect(logEntries).toHaveLength(1)
    expect(logEntries[0].kind).toBe('app.rejection_tracker_unavailable')
    expect(logEntries[0].level).toBe('warn')
  })

  it('records app.rejection_tracker_unavailable even when the diagnostics gate is OFF', () => {
    configureDiagnosticsGate({ isEnabled: () => false, isDebugEnabled: () => false })
    registerRejectionHandler({})
    const { logEntries } = getDiagnosticsSnapshot()
    expect(logEntries).toHaveLength(1)
    expect(logEntries[0].kind).toBe('app.rejection_tracker_unavailable')
  })
})
