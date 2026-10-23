import { describe, expect, it } from 'vitest'

import { dedupeTerms, foldStackables, newTerms } from './keyword-terms'

describe('dedupeTerms', () => {
  it('collapses case variants to the first spelling', () => {
    expect(dedupeTerms(['The Grey Wolf', 'the grey wolf', 'THE GREY WOLF'])).toEqual([
      'The Grey Wolf',
    ])
  })

  it('collapses the composed and decomposed forms of one term', () => {
    expect(dedupeTerms(['Café', 'Café'])).toEqual(['Café'])
  })

  it('trims, drops blanks and keeps distinct terms in order', () => {
    expect(dedupeTerms(['  the innkeeper ', '', '   ', 'your brother'])).toEqual([
      'the innkeeper',
      'your brother',
    ])
  })
})

describe('newTerms', () => {
  it('keeps only terms the current list lacks, case and spacing aside', () => {
    expect(
      newTerms(['The Grey Wolf'], [' the grey wolf ', ' the innkeeper ', 'The Innkeeper', '']),
    ).toEqual(['the innkeeper'])
  })

  it('returns nothing when every term is already held', () => {
    expect(newTerms(['a', 'b'], ['A', ' b'])).toEqual([])
  })

  it('matches the current list under the same normalization as incoming', () => {
    expect(newTerms([' The Grey Wolf ', 'Café'], ['the grey wolf', 'Café'])).toEqual([])
  })
})

describe('foldStackables', () => {
  it('sums case variants under one key and drops blank keys and empty balances', () => {
    expect([...foldStackables({ Gold: 5, gold: 3, ' ': 4, rope: 0 })]).toEqual([['gold', 8]])
    expect(foldStackables(undefined).size).toBe(0)
  })

  it('sums a key with a line break under its single-spaced spelling', () => {
    expect([...foldStackables({ 'Silver\n coins': 3, 'silver coins': 4 })]).toEqual([
      ['silver coins', 7],
    ])
  })
})
