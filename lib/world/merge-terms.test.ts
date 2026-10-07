import { describe, expect, it } from 'vitest'

import { mergedTerms, type MergeDeselections } from './merge-terms'

const NONE: MergeDeselections = { deselectedTags: [], deselectedKeywords: [] }

describe('mergedTerms', () => {
  it("keeps the canonical's terms in stored order, then the other row's additions sorted", () => {
    expect(
      mergedTerms(
        {
          canonical: { tags: ['watch', 'guard'], keywords: ['the sergeant', 'Brannoc'] },
          other: { tags: ['smuggler', 'guard', 'Alpha'], keywords: ['the river gate', 'Amber'] },
        },
        NONE,
      ),
    ).toStrictEqual({
      tags: ['watch', 'guard', 'Alpha', 'smuggler'],
      keywords: ['the sergeant', 'Brannoc', 'Amber', 'the river gate'],
    })
  })

  it("keeps a shared keyword once, in the canonical's first spelling", () => {
    expect(
      mergedTerms(
        {
          canonical: { tags: [], keywords: [' The Courier ', 'the courier'] },
          other: { tags: [], keywords: ['THE COURIER', 'grey wolf'] },
        },
        NONE,
      ).keywords,
    ).toStrictEqual(['The Courier', 'grey wolf'])
  })

  it('drops deselected tags by their trimmed text and keywords by their normalized key', () => {
    expect(
      mergedTerms(
        {
          canonical: { tags: ['guard', 'watch'], keywords: ['the guard', 'Sergeant'] },
          other: { tags: ['captain', 'Guard'], keywords: ['Captain Brannoc', 'the gate'] },
        },
        { deselectedTags: [' watch', 'Guard'], deselectedKeywords: ['sergeant', 'THE GATE'] },
      ),
    ).toStrictEqual({ tags: ['guard', 'captain'], keywords: ['the guard', 'Captain Brannoc'] })
  })

  it('cleans blank, padded and repeated terms on either row', () => {
    expect(
      mergedTerms(
        {
          canonical: { tags: [' guard', '', 'guard'], keywords: ['  ', 'the guard '] },
          other: { tags: ['captain ', 'captain', ' '], keywords: ['', ' Captain'] },
        },
        NONE,
      ),
    ).toStrictEqual({ tags: ['guard', 'captain'], keywords: ['the guard', 'Captain'] })
  })
})
