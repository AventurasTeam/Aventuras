import { describe, expect, it } from 'vitest'

import { closeAfterDelete } from './close-after-delete'

const THRESHOLD = 8_000

describe('closeAfterDelete', () => {
  it('closes at the next Send with auto-close on and the region at the threshold', () => {
    expect(
      closeAfterDelete({
        tokensAfter: 8_000,
        threshold: THRESHOLD,
        autoClose: true,
        manualPending: false,
      }),
    ).toBe('closes-next-send')
  })

  it('closes at the next Send one token above the threshold', () => {
    expect(
      closeAfterDelete({
        tokensAfter: 8_001,
        threshold: THRESHOLD,
        autoClose: true,
        manualPending: false,
      }),
    ).toBe('closes-next-send')
  })

  it('waits one token under the threshold', () => {
    expect(
      closeAfterDelete({
        tokensAfter: 7_999,
        threshold: THRESHOLD,
        autoClose: true,
        manualPending: false,
      }),
    ).toBe('waits')
  })

  it.each([0, 16_000])('stays open with auto-close off at %i tokens', (tokensAfter) => {
    expect(
      closeAfterDelete({
        tokensAfter,
        threshold: THRESHOLD,
        autoClose: false,
        manualPending: false,
      }),
    ).toBe('stays-open')
  })

  it('closes at the next Send with a manual close pending under the threshold', () => {
    expect(
      closeAfterDelete({
        tokensAfter: 2_000,
        threshold: THRESHOLD,
        autoClose: true,
        manualPending: true,
      }),
    ).toBe('closes-next-send')
  })

  it('closes at the next Send with a manual close pending and auto-close off', () => {
    expect(
      closeAfterDelete({
        tokensAfter: 2_000,
        threshold: THRESHOLD,
        autoClose: false,
        manualPending: true,
      }),
    ).toBe('closes-next-send')
  })

  it('closes at the next Send with a manual close pending at the threshold and auto-close off', () => {
    expect(
      closeAfterDelete({
        tokensAfter: 16_000,
        threshold: THRESHOLD,
        autoClose: false,
        manualPending: true,
      }),
    ).toBe('closes-next-send')
  })
})
