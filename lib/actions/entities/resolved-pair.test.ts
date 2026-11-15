import { describe, expect, it } from 'vitest'

import { RESOLVED_PAIR_KEY, resolvesPair } from './resolved-pair'

describe('resolvesPair', () => {
  const cleared = { nameCollisionFlag: 1, nameCollisionPartnerId: 'char_mira' }

  it('reads the meta key over a prior flag a reversal rewrote to another partner', () => {
    const rewritten = { ...cleared, [RESOLVED_PAIR_KEY]: 'char_quinn' }
    expect(resolvesPair(rewritten, 'char_quinn')).toBe(true)
    expect(resolvesPair(rewritten, 'char_mira')).toBe(false)
  })

  it('reads the prior flag of an edit logged without the key', () => {
    expect(resolvesPair(cleared, 'char_mira')).toBe(true)
    expect(resolvesPair({ ...cleared, nameCollisionFlag: 0 }, 'char_mira')).toBe(false)
    expect(resolvesPair(cleared, 'char_quinn')).toBe(false)
  })
})
