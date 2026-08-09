import { beforeEach, describe, expect, it } from 'vitest'

import { __resetCaptureMode, armDeepCapture, peekCaptureMode, spendCaptureMode } from './mode'

describe('deep-capture arming', () => {
  beforeEach(() => {
    __resetCaptureMode()
  })

  it('captures light until something arms a deep one', () => {
    expect(peekCaptureMode()).toBe('light')
    spendCaptureMode()
    expect(peekCaptureMode()).toBe('light')
  })

  it('arms exactly one deep capture, disarming when the write spends it', () => {
    armDeepCapture()

    expect(peekCaptureMode()).toBe('deep')
    spendCaptureMode()
    expect(peekCaptureMode()).toBe('light')
  })

  it('keeps the arm loaded while nothing spends it', () => {
    armDeepCapture()

    // The write-failure path: peeked for a capture that never landed, so the
    // next turn must still be the deep one the user armed.
    expect(peekCaptureMode()).toBe('deep')
    expect(peekCaptureMode()).toBe('deep')
    spendCaptureMode()
    expect(peekCaptureMode()).toBe('light')
  })

  it('arms again after a consumed deep capture', () => {
    armDeepCapture()
    spendCaptureMode()
    armDeepCapture()

    expect(peekCaptureMode()).toBe('deep')
  })

  it('drops an arm nothing consumed', () => {
    armDeepCapture()
    __resetCaptureMode()

    expect(peekCaptureMode()).toBe('light')
  })
})
