import { describe, expect, it } from 'vitest'

import { readerHref } from './reader-href'

describe('readerHref', () => {
  it('is the bare route with no entry', () => {
    expect(readerHref('br_1')).toBe('/reader-composer/br_1')
  })

  it('carries the entry as a query param', () => {
    expect(readerHref('br_1', 'entry_hero_0022')).toBe(
      '/reader-composer/br_1?entry=entry_hero_0022',
    )
  })

  it('encodes an entry id the query would otherwise misread', () => {
    expect(readerHref('br_1', 'a&b=c')).toBe('/reader-composer/br_1?entry=a%26b%3Dc')
  })
})
