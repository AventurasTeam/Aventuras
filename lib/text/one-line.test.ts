import { describe, expect, it } from 'vitest'

import { oneLine } from './one-line'

describe('oneLine', () => {
  it('turns every whitespace run, line breaks included, into one space and trims', () => {
    expect(oneLine('  a blade\n\nthat glows\t near  the dead \n')).toBe(
      'a blade that glows near the dead',
    )
  })
})
