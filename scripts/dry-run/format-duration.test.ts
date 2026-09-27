import { describe, expect, it } from 'vitest'

import { formatDuration } from './format-duration'

describe('formatDuration', () => {
  it('formats hours, minutes and seconds', () => {
    expect(formatDuration(3_723_000)).toBe('1h 2m 3s')
  })

  it('omits zero units and drops milliseconds', () => {
    expect(formatDuration(60_000)).toBe('1m')
    expect(formatDuration(3_600_999)).toBe('1h')
  })

  it('formats zero as 0s', () => {
    expect(formatDuration(0)).toBe('0s')
  })
})
