import { describe, expect, it } from 'vitest'

import { ulid } from './ulid'

describe('ulid', () => {
  it('generates a 26-char Crockford base32 id', () => {
    const id = ulid()
    expect(id).toHaveLength(26)
    // Crockford base32: 0-9 A-Z minus I, L, O, U
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/)
  })

  it('generates unique ids across many calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => ulid()))
    expect(ids.size).toBe(1000)
  })
})
