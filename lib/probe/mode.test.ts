import { beforeEach, describe, expect, it } from 'vitest'

import {
  __resetCaptureMode,
  armDeepCapture,
  commitCaptureMode,
  peekCaptureMode,
  reserveCaptureMode,
} from './mode'

describe('deep-capture arming', () => {
  beforeEach(() => {
    __resetCaptureMode()
  })

  it('captures light until something arms a deep one', () => {
    expect(peekCaptureMode()).toBe('light')
    commitCaptureMode(reserveCaptureMode())
    expect(peekCaptureMode()).toBe('light')
  })

  it('arms exactly one deep capture, disarming when the write spends it', () => {
    armDeepCapture()
    const reservation = reserveCaptureMode()

    expect(reservation.mode).toBe('deep')
    commitCaptureMode(reservation)
    expect(peekCaptureMode()).toBe('light')
  })

  it('keeps the arm loaded while nothing spends it', () => {
    armDeepCapture()

    // The write-failure path: reserved for a capture that never landed, so the
    // next turn must still be the deep one the user armed.
    expect(reserveCaptureMode().mode).toBe('deep')
    expect(reserveCaptureMode().mode).toBe('deep')
    commitCaptureMode(reserveCaptureMode())
    expect(peekCaptureMode()).toBe('light')
  })

  it('arms again after a consumed deep capture', () => {
    armDeepCapture()
    commitCaptureMode(reserveCaptureMode())
    armDeepCapture()

    expect(peekCaptureMode()).toBe('deep')
  })

  // The write awaits a transaction; arming during it is the one window where a
  // commit could spend an arm it never read.
  it('leaves an arm raised after the reservation for the next capture', () => {
    const reservation = reserveCaptureMode()
    armDeepCapture()

    commitCaptureMode(reservation)

    expect(peekCaptureMode()).toBe('deep')
  })

  it('leaves a re-arm raised mid-write, even when the in-flight capture was deep too', () => {
    armDeepCapture()
    const reservation = reserveCaptureMode()
    armDeepCapture()

    commitCaptureMode(reservation)

    expect(peekCaptureMode()).toBe('deep')
  })

  it('drops an arm nothing consumed', () => {
    armDeepCapture()
    __resetCaptureMode()

    expect(peekCaptureMode()).toBe('light')
  })
})
