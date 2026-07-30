import { describe, expect, it } from 'vitest'

import {
  BACKOFF_MS,
  idleStatus,
  nextStatusOnFailure,
  nextStatusOnStart,
  nextStatusOnSuccess,
  shouldCadenceFire,
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
  it('walks the backoff 30s -> 2m -> 5m then lands failed-persistent', () => {
    let status = idleStatus()
    const delays: (number | null)[] = []
    for (let i = 0; i < 4; i++) {
      const next = nextStatusOnFailure(status, { error: 'rate limited', at: 0 })
      delays.push(next.retryDelayMs)
      status = next.status
    }
    expect(delays).toEqual([...BACKOFF_MS, null])
    expect(BACKOFF_MS).toEqual([30_000, 120_000, 300_000])
    expect(status.state).toBe('failed-persistent')
    expect(status.lastError).toBe('rate limited')
    expect(status.retryCount).toBe(3)
  })

  it('preserves the watermark across failures', () => {
    const { status } = nextStatusOnFailure(
      { state: 'running', lastSuccessAt: 5, lastError: null, retryCount: 0, processedThrough: 7 },
      { error: 'network', at: 0 },
    )
    expect(status.processedThrough).toBe(7)
  })
})

describe('shouldCadenceFire', () => {
  it('fires when the unprocessed count reaches the cadence', () => {
    expect(shouldCadenceFire({ status: idleStatus(), headPosition: 8, cadence: 8 })).toBe(true)
    expect(shouldCadenceFire({ status: idleStatus(), headPosition: 7, cadence: 8 })).toBe(false)
  })

  it('counts from the watermark, not from zero', () => {
    const status = { ...idleStatus(), processedThrough: 10 }
    expect(shouldCadenceFire({ status, headPosition: 17, cadence: 8 })).toBe(false)
    expect(shouldCadenceFire({ status, headPosition: 18, cadence: 8 })).toBe(true)
  })

  it('suspends in failed-persistent', () => {
    const status = { ...idleStatus(), state: 'failed-persistent' as const }
    expect(shouldCadenceFire({ status, headPosition: 99, cadence: 1 })).toBe(false)
  })

  it('does not fire while a run is already recorded as running', () => {
    const status = { ...idleStatus(), state: 'running' as const }
    expect(shouldCadenceFire({ status, headPosition: 99, cadence: 1 })).toBe(false)
  })

  it('treats a non-positive cadence as "every turn" rather than dividing by zero', () => {
    expect(shouldCadenceFire({ status: idleStatus(), headPosition: 1, cadence: 0 })).toBe(true)
  })
})

describe('nextStatusOnStart', () => {
  it('marks running without touching the watermark or the error', () => {
    const status = nextStatusOnStart({ ...idleStatus(), processedThrough: 3, lastError: 'boom' })
    expect(status).toMatchObject({ state: 'running', processedThrough: 3, lastError: 'boom' })
  })
})
