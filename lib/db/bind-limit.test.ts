import { describe, expect, it } from 'vitest'

import { BIND_CHUNK, chunked } from './bind-limit'

describe('chunked', () => {
  it('returns no chunks for no items', () => {
    expect(chunked([])).toEqual([])
  })

  it('keeps a list at the bind chunk in one statement and splits one past it', () => {
    const atCap = Array.from({ length: BIND_CHUNK }, (_, i) => i)
    expect(chunked(atCap)).toEqual([atCap])

    const pastCap = [...atCap, BIND_CHUNK]
    expect(chunked(pastCap)).toEqual([atCap, [BIND_CHUNK]])
  })

  it('splits by an explicit size, keeping order', () => {
    expect(chunked(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']])
  })
})
