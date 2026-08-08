import { describe, it, expect } from 'vitest'
import { secondPassHaystack } from './tier2SecondPass'

describe('secondPassHaystack', () => {
  it('joins the names the first pass matched', () => {
    expect(secondPassHaystack(['Borin', 'Iron Mountain'])).toBe('iron mountain borin')
  })

  it('drops a name shorter than four characters', () => {
    // Word-boundary matching makes "Zyl" hit every sentence that happens to contain it.
    expect(secondPassHaystack(['Zyl', 'Morvana'])).toBe('morvana')
  })

  it('drops a seed another seed already contains', () => {
    // "Iron" would match everything "Iron Mountain" matches, plus everything else with
    // "iron" in it.
    expect(secondPassHaystack(['Iron', 'Iron Mountain'])).toBe('iron mountain')
  })

  // Containment has to be word-bounded, because the matching it stands in for is. A
  // word-boundary search for "ariadne" never finds "Aria", so dropping "Aria" as
  // "already covered" loses it outright — plain substring containment did exactly that.
  it('keeps a seed that is only a substring of another, not a word of it', () => {
    expect(secondPassHaystack(['Aria', 'Ariadne'])).toBe('ariadne aria')
  })

  it('still drops a seed contained as a whole word', () => {
    expect(secondPassHaystack(['Mountain', 'Iron Mountain'])).toBe('iron mountain')
  })

  it('survives a name with regex metacharacters', () => {
    // Names are user text: an unescaped "(" would throw out of the filter.
    expect(() => secondPassHaystack(['R.J. (the Fox)', 'R.J.'])).not.toThrow()
  })

  it('keeps names that merely share a word', () => {
    const result = secondPassHaystack(['Iron Mountain', 'Iron Bell'])
    expect(result).toContain('iron mountain')
    expect(result).toContain('iron bell')
  })

  it('deduplicates, ignoring case and surrounding space', () => {
    expect(secondPassHaystack(['Borin', ' borin ', 'BORIN'])).toBe('borin')
  })

  it('ignores empty and missing names', () => {
    expect(secondPassHaystack([null, undefined, '', '   '])).toBe('')
  })

  it('returns an empty string when nothing survives, so the caller can skip the pass', () => {
    expect(secondPassHaystack(['Zyl', 'Ren'])).toBe('')
  })
})
