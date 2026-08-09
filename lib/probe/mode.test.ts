import { beforeEach, describe, expect, it } from 'vitest'

import { __resetCaptureMode, armDeepCapture, takeNextCaptureMode } from './mode'

describe('deep-capture arming', () => {
  beforeEach(() => {
    __resetCaptureMode()
  })

  it('captures light until something arms a deep one', () => {
    expect(takeNextCaptureMode()).toBe('light')
    expect(takeNextCaptureMode()).toBe('light')
  })

  it('arms exactly one deep capture, disarming on the read', () => {
    armDeepCapture()

    expect(takeNextCaptureMode()).toBe('deep')
    expect(takeNextCaptureMode()).toBe('light')
  })

  it('arms again after a consumed deep capture', () => {
    armDeepCapture()
    takeNextCaptureMode()
    armDeepCapture()

    expect(takeNextCaptureMode()).toBe('deep')
  })

  it('drops an arm nothing consumed', () => {
    armDeepCapture()
    __resetCaptureMode()

    expect(takeNextCaptureMode()).toBe('light')
  })
})
