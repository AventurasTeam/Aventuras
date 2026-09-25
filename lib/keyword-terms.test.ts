import { describe, expect, it } from 'vitest'

import { dedupeTerms, newTerms } from './keyword-terms'

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
