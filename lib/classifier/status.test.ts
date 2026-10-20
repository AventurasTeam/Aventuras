import { describe, expect, it } from 'vitest'

import {
  CLASSIFIER_MAX_RETRIES,
  idleStatus,
  nextStatusOnFailure,
  nextStatusOnStart,
  nextStatusOnSuccess,
  shouldCadenceFire,
  worstCaseCadenceEntries,
} from './status'

describe('nextStatusOnSuccess', () => {
  it('clears the error, resets attempts and advances the watermark', () => {
    const next = nextStatusOnSuccess(
      {
        state: 'retrying',
        lastSuccessAt: null,
        lastError: 'boom',
        retryCount: 2,
        processedThrough: 4,
      },
      { coversThrough: 9, at: 1_000 },
    )
    expect(next).toEqual({
      state: 'idle',
      lastSuccessAt: 1_000,
      lastError: null,
      retryCount: 0,
      processedThrough: 9,
    })
  })

  it('never moves the watermark backwards', () => {
    const next = nextStatusOnSuccess(
      {
        state: 'running',
        lastSuccessAt: null,
        lastError: null,
        retryCount: 0,
        processedThrough: 12,
      },
      { coversThrough: 9, at: 1_000 },
    )
    expect(next.processedThrough).toBe(12)
  })
})

describe('nextStatusOnFailure', () => {
  it('takes one attempt and three retries, then lands failed-persistent', () => {
    let status = idleStatus()
    const seen: [string, number][] = []
    for (let i = 0; i < 4; i++) {
      status = nextStatusOnFailure(status, { error: 'rate limited', at: 0 })
      seen.push([status.state, status.retryCount])
    }
    expect(seen).toEqual([
      ['retrying', 1],
      ['retrying', 2],
      ['retrying', 3],
      ['failed-persistent', 3],
    ])
    expect(status.lastError).toBe('rate limited')
    expect(CLASSIFIER_MAX_RETRIES).toBe(3)
  })

  it('stays failed-persistent with its count capped when Run now fails again', () => {
    const status = nextStatusOnFailure(
      { ...idleStatus(), state: 'failed-persistent', retryCount: 3, lastError: 'old' },
      { error: 'still down', at: 0 },
    )
    expect(status).toMatchObject({
      state: 'failed-persistent',
      retryCount: 3,
      lastError: 'still down',
    })
  })

  it('preserves the watermark and the last success across failures', () => {
    const status = nextStatusOnFailure(
      { state: 'running', lastSuccessAt: 5, lastError: null, retryCount: 0, processedThrough: 7 },
      { error: 'network', at: 0 },
    )
    expect(status).toMatchObject({ processedThrough: 7, lastSuccessAt: 5 })
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

  it('suspends in failed-persistent', () => {
    const status = { ...idleStatus(), state: 'failed-persistent' as const }
    expect(shouldCadenceFire({ status, unprocessedEntries: 99, cadence: 1 })).toBe(false)
  })

  it('does not fire for a running status, which a crash left for boot to quarantine', () => {
    const status = { ...idleStatus(), state: 'running' as const }
    expect(shouldCadenceFire({ status, unprocessedEntries: 99, cadence: 1 })).toBe(false)
  })

  it('fires for a retrying status once the count is due, so the retry rides the turn', () => {
    const status = { ...idleStatus(), state: 'retrying' as const, retryCount: 2 }
    expect(shouldCadenceFire({ status, unprocessedEntries: 8, cadence: 8 })).toBe(true)
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
