import { describe, expect, it } from 'vitest'

import { namedInProse } from './name-match'

const PROSE =
  'The Syndicate, he says, since the spring. They tax the ferry, the road and the bread.'

describe('namedInProse', () => {
  it('finds a row by its name, whatever its case and spacing', () => {
    expect(namedInProse(PROSE, { name: 'the syndicate', keywords: [] })).toBe(true)
    expect(namedInProse(PROSE, { name: '  THE SYNDICATE ', keywords: [] })).toBe(true)
  })

  it('finds a row by a keyword', () => {
    expect(namedInProse(PROSE, { name: 'The Toll Lords', keywords: ['the bread'] })).toBe(true)
  })

  it('matches whole words, not a name inside another word', () => {
    expect(namedInProse('A miracle on the road.', { name: 'Mira', keywords: [] })).toBe(false)
  })

  it('reads only string keywords from a list, and no list as none', () => {
    expect(namedInProse(PROSE, { name: 'Wren', keywords: ['  ', 42, null] })).toBe(false)
    expect(namedInProse(PROSE, { name: 'Wren', keywords: 'the ferry' })).toBe(false)
    expect(namedInProse(PROSE, { name: 'Wren', keywords: [42, 'the ferry'] })).toBe(true)
  })

  it('finds nothing for a blank name with no keywords', () => {
    expect(namedInProse(PROSE, { name: ' ', keywords: [] })).toBe(false)
  })
})
