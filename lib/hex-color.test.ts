import { describe, expect, it } from 'vitest'

import { HEX_COLOR } from './hex-color'

describe('HEX_COLOR', () => {
  it.each(['#abc', '#aabbcc', '#ABC', '#A1b2C3'])('accepts %s', (value) => {
    expect(HEX_COLOR.test(value)).toBe(true)
  })

  it.each(['abc', 'aabbcc', '#ab', '#abcd', '#aabbccdd', '#ggg', ' #abc', 'red'])(
    'rejects %j',
    (value) => {
      expect(HEX_COLOR.test(value)).toBe(false)
    },
  )
})
