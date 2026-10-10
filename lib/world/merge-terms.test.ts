import { describe, expect, it } from 'vitest'

import { addedNameKeyword, mergedTerms, type MergeTermChoices } from './merge-terms'

const NONE: MergeTermChoices = { deselectedTags: [], deselectedKeywords: [], nameFromOther: false }

describe('mergedTerms', () => {
  it("keeps the canonical's terms in stored order, then the other row's additions sorted", () => {
    expect(
      mergedTerms(
        {
          canonical: {
            name: 'Kael',
            tags: ['watch', 'guard'],
            keywords: ['the sergeant', 'Brannoc'],
          },
          other: {
            name: 'Kael',
            tags: ['smuggler', 'guard', 'Alpha'],
            keywords: ['the river gate', 'Amber'],
          },
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
          canonical: { name: 'Kael', tags: [], keywords: [' The Courier ', 'the courier'] },
          other: { name: 'Kael', tags: [], keywords: ['THE COURIER', 'grey wolf'] },
        },
        NONE,
      ).keywords,
    ).toStrictEqual(['The Courier', 'grey wolf'])
  })

  it('drops deselected tags by their trimmed text and keywords by their normalized key', () => {
    expect(
      mergedTerms(
        {
          canonical: {
            name: 'Kael',
            tags: ['guard', 'watch'],
            keywords: ['the guard', 'Sergeant'],
          },
          other: {
            name: 'Kael',
            tags: ['captain', 'Guard'],
            keywords: ['Captain Brannoc', 'the gate'],
          },
        },
        {
          deselectedTags: [' watch', 'Guard'],
          deselectedKeywords: ['sergeant', 'THE GATE'],
          nameFromOther: false,
        },
      ),
    ).toStrictEqual({ tags: ['guard', 'captain'], keywords: ['the guard', 'Captain Brannoc'] })
  })

  it('cleans blank, padded and repeated terms on either row', () => {
    expect(
      mergedTerms(
        {
          canonical: {
            name: 'Kael',
            tags: [' guard', '', 'guard'],
            keywords: ['  ', 'the guard '],
          },
          other: { name: 'Kael', tags: ['captain ', 'captain', ' '], keywords: ['', ' Captain'] },
        },
        NONE,
      ),
    ).toStrictEqual({ tags: ['guard', 'captain'], keywords: ['the guard', 'Captain'] })
  })
})

describe('mergedTerms — the name the merge does not keep', () => {
  const canonical = { name: 'Kael', tags: [], keywords: ['the courier'] }
  const stormborn = { name: 'Kael Stormborn', tags: [], keywords: ['Amber', 'the river gate'] }
  const keywordsOf = (
    rows: Parameters<typeof mergedTerms>[0],
    choices: Partial<MergeTermChoices> = {},
  ) => mergedTerms(rows, { ...NONE, ...choices }).keywords

  it.each(['Kael', ' KAEL '])('adds nothing when the other row is named %j', (name) => {
    const rows = { canonical, other: { ...stormborn, name } }
    expect(keywordsOf(rows)).toStrictEqual(['the courier', 'Amber', 'the river gate'])
    expect(keywordsOf(rows, { nameFromOther: true })).toStrictEqual([
      'the courier',
      'Amber',
      'the river gate',
    ])
    expect(addedNameKeyword(rows, false)).toBeNull()
    expect(addedNameKeyword(rows, true)).toBeNull()
  })

  it('adds nothing for a blank name it does not keep', () => {
    expect(addedNameKeyword({ canonical, other: { ...stormborn, name: '  ' } }, false)).toBeNull()
    expect(
      addedNameKeyword({ canonical: { ...canonical, name: '  ' }, other: stormborn }, true),
    ).toBeNull()
  })

  it("adds the other row's name, trimmed, among its additions when the canonical's is kept", () => {
    const rows = { canonical, other: { ...stormborn, name: ' Kael Stormborn ' } }
    expect(keywordsOf(rows)).toStrictEqual([
      'the courier',
      'Amber',
      'Kael Stormborn',
      'the river gate',
    ])
    expect(addedNameKeyword(rows, false)).toBe('Kael Stormborn')
  })

  it("adds the canonical's name among the other row's additions when the other's is kept", () => {
    const rows = { canonical, other: stormborn }
    expect(keywordsOf(rows, { nameFromOther: true })).toStrictEqual([
      'the courier',
      'Amber',
      'Kael',
      'the river gate',
    ])
    expect(addedNameKeyword(rows, true)).toBe('Kael')
  })

  it('adds nothing when either row already has the name as a keyword', () => {
    const onCanonical = {
      canonical: { ...canonical, keywords: ['kael stormborn'] },
      other: stormborn,
    }
    expect(addedNameKeyword(onCanonical, false)).toBeNull()
    expect(keywordsOf(onCanonical)).toStrictEqual(['kael stormborn', 'Amber', 'the river gate'])

    const onOther = { canonical, other: { ...stormborn, keywords: [' KAEL STORMBORN '] } }
    expect(addedNameKeyword(onOther, false)).toBeNull()
    expect(keywordsOf(onOther)).toStrictEqual(['the courier', 'KAEL STORMBORN'])
  })

  it('drops the added name when its key is deselected', () => {
    expect(
      keywordsOf({ canonical, other: stormborn }, { deselectedKeywords: ['KAEL STORMBORN'] }),
    ).toStrictEqual(['the courier', 'Amber', 'the river gate'])
  })
})
