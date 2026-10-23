import { describe, expect, it } from 'vitest'

import {
  idleStatus,
  nextStatusOnFailure,
  nextStatusOnStart,
  nextStatusOnSuccess,
  shouldCadenceFire,
  worstCaseCadenceEntries,
} from './status'

describe('idleStatus', () => {
  // classifier.md → Persistence: state, last success, last error and the watermark, nothing more.
  it('carries the four persisted keys and no attempt counter', () => {
    expect(idleStatus()).toEqual({
      state: 'idle',
      lastSuccessAt: null,
      lastError: null,
      processedThrough: null,
    })
  })
})

describe('nextStatusOnSuccess', () => {
  it('clears the error, lands idle and advances the watermark', () => {
    const next = nextStatusOnSuccess(
      { state: 'failed', lastSuccessAt: null, lastError: 'boom', processedThrough: 4 },
      { coversThrough: 9, at: 1_000 },
    )
    expect(next).toEqual({
      state: 'idle',
      lastSuccessAt: 1_000,
      lastError: null,
      processedThrough: 9,
    })
  })

  it('never moves the watermark backwards', () => {
    const next = nextStatusOnSuccess(
      { state: 'running', lastSuccessAt: null, lastError: null, processedThrough: 12 },
      { coversThrough: 9, at: 1_000 },
    )
    expect(next.processedThrough).toBe(12)
  })
})

describe('nextStatusOnFailure', () => {
  // classifier.md → Failure policy: no attempt counter, no suspension.
  it('lands failed with the latest error however many times the pass fails', () => {
    let status = idleStatus()
    const seen: [string, string | null][] = []
    for (const error of ['rate limited', 'network', 'invalid key', 'network']) {
      status = nextStatusOnFailure(status, { error, at: 0 })
      seen.push([status.state, status.lastError])
    }
    expect(seen).toEqual([
      ['failed', 'rate limited'],
      ['failed', 'network'],
      ['failed', 'invalid key'],
      ['failed', 'network'],
    ])
  })

  it('preserves the watermark and the last success, adding no key', () => {
    const status = nextStatusOnFailure(
      { state: 'running', lastSuccessAt: 5, lastError: null, processedThrough: 7 },
      { error: 'network', at: 0 },
    )
    expect(status).toEqual({
      state: 'failed',
      lastSuccessAt: 5,
      lastError: 'network',
      processedThrough: 7,
    })
  })
})

describe('worstCaseCadenceEntries', () => {
  it('allows one entry past the cadence, whatever its parity', () => {
    expect(worstCaseCadenceEntries(8)).toBe(9)
    expect(worstCaseCadenceEntries(5)).toBe(6)
    expect(worstCaseCadenceEntries(1)).toBe(2)
    expect(worstCaseCadenceEntries(0)).toBe(2)
  })
})

describe('shouldCadenceFire', () => {
  it('fires when the unprocessed count reaches the cadence', () => {
    expect(shouldCadenceFire({ status: idleStatus(), unprocessedEntries: 8, cadence: 8 })).toBe(
      true,
    )
    expect(shouldCadenceFire({ status: idleStatus(), unprocessedEntries: 7, cadence: 8 })).toBe(
      false,
    )
  })

  it('takes the unprocessed count from the caller, watermark already applied', () => {
    const status = { ...idleStatus(), processedThrough: 10 }
    expect(shouldCadenceFire({ status, unprocessedEntries: 7, cadence: 8 })).toBe(false)
    expect(shouldCadenceFire({ status, unprocessedEntries: 8, cadence: 8 })).toBe(true)
  })

  it('does not fire for a running status, a pass left unfinished until boot resets it', () => {
    const status = { ...idleStatus(), state: 'running' as const }
    expect(shouldCadenceFire({ status, unprocessedEntries: 99, cadence: 1 })).toBe(false)
  })

  // classifier.md → Failure policy: every due commit is a fresh attempt, whatever the cause.
  it('fires for a failed status once the count is due', () => {
    const status = { ...idleStatus(), state: 'failed' as const, lastError: 'invalid key' }
    expect(shouldCadenceFire({ status, unprocessedEntries: 8, cadence: 8 })).toBe(true)
    expect(shouldCadenceFire({ status, unprocessedEntries: 7, cadence: 8 })).toBe(false)
  })

  it('treats a non-positive cadence as "every turn" rather than dividing by zero', () => {
    expect(shouldCadenceFire({ status: idleStatus(), unprocessedEntries: 1, cadence: 0 })).toBe(
      true,
    )
  })
})

describe('nextStatusOnStart', () => {
  it('marks running without touching the watermark or the error', () => {
    const status = nextStatusOnStart({ ...idleStatus(), processedThrough: 3, lastError: 'boom' })
    expect(status).toMatchObject({ state: 'running', processedThrough: 3, lastError: 'boom' })
  })
})
