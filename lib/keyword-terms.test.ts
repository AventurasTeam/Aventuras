import { describe, expect, it } from 'vitest'

import {
  dedupeTerms,
  foldStackables,
  newTerms,
  normalizeStackables,
  sameStackables,
} from './keyword-terms'

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

// chapter-close.md → 3c. Expectations are written out by hand, never derived from the rule.
describe('normalizeStackables', () => {
  const normalize = (records: Record<string, Record<string, number> | undefined>) =>
    Object.fromEntries(normalizeStackables(new Map(Object.entries(records))))

  it('folds case variants into one lowercase key, summing them', () => {
    expect(normalize({ char_a: { Gold: 5, gold: 3 } })).toEqual({ char_a: { gold: 8 } })
  })

  it('folds a plural onto a singular another record holds', () => {
    expect(normalize({ char_a: { arrows: 12 }, char_b: { arrow: 1 } })).toEqual({
      char_a: { arrow: 12 },
      char_b: { arrow: 1 },
    })
  })

  it('folds a plural onto a singular its own record holds, summing', () => {
    expect(normalize({ char_a: { arrow: 1, Arrows: 4 } })).toEqual({ char_a: { arrow: 5 } })
  })

  it('keeps a plural whose singular no record holds', () => {
    expect(normalize({ char_a: { arrows: 12 } })).toEqual({ char_a: { arrows: 12 } })
    expect(normalize({ char_a: { glass: 2 } })).toEqual({ char_a: { glass: 2 } })
  })

  it('never strips the s of a double s, even when the stripped key is held', () => {
    expect(normalize({ char_a: { glass: 2 }, char_b: { glas: 1 } })).toEqual({
      char_a: { glass: 2 },
      char_b: { glas: 1 },
    })
  })

  it('folds -es and -ies plurals only onto a singular that is held', () => {
    expect(
      normalize({ char_a: { torches: 2, berries: 3 }, char_b: { torch: 1, berry: 4 } }),
    ).toEqual({ char_a: { torch: 2, berry: 3 }, char_b: { torch: 1, berry: 4 } })
    expect(normalize({ char_a: { torches: 2, berries: 3 } })).toEqual({
      char_a: { torches: 2, berries: 3 },
    })
  })

  it('tries -ies, then -es, then -s, and the first held key wins', () => {
    expect(
      normalize({
        char_a: { berries: 3, torches: 2 },
        char_b: { berry: 1, berrie: 1, torch: 1, torche: 1 },
      }),
    ).toEqual({
      char_a: { berry: 3, torch: 2 },
      char_b: { berry: 1, berrie: 1, torch: 1, torche: 1 },
    })
  })

  it.each([
    ['torches', 'torch'],
    ['dishes', 'dish'],
    ['boxes', 'box'],
    ['buses', 'bus'],
    ['glasses', 'glass'],
    ['waltzes', 'waltz'],
    ['potatoes', 'potato'],
    ['berries', 'berry'],
    ['arrows', 'arrow'],
    ['shoes', 'shoe'],
    ['gold coins', 'gold coin'],
  ])('folds %s onto %s when it is held', (plural, singular) => {
    expect(normalize({ char_a: { [plural]: 2 }, char_b: { [singular]: 1 } })).toEqual({
      char_a: { [singular]: 2 },
      char_b: { [singular]: 1 },
    })
  })

  it('folds capes onto cape, not cap, when both are held', () => {
    expect(normalize({ char_a: { capes: 2 }, char_b: { cap: 1, cape: 1 } })).toEqual({
      char_a: { cape: 2 },
      char_b: { cap: 1, cape: 1 },
    })
  })

  it('keeps capes when only cap is held', () => {
    expect(normalize({ char_a: { capes: 2 }, char_b: { cap: 1 } })).toEqual({
      char_a: { capes: 2 },
      char_b: { cap: 1 },
    })
  })

  it('keeps kites when only kit is held', () => {
    expect(normalize({ char_a: { kites: 2 }, char_b: { kit: 1 } })).toEqual({
      char_a: { kites: 2 },
      char_b: { kit: 1 },
    })
  })

  it('folds canes onto cane, not can, when both are held', () => {
    expect(normalize({ char_a: { canes: 2 }, char_b: { can: 1, cane: 1 } })).toEqual({
      char_a: { cane: 2 },
      char_b: { can: 1, cane: 1 },
    })
  })

  it('folds soles onto sole, not sol, when both are held: the stem must end in the letter', () => {
    expect(normalize({ char_a: { soles: 2 }, char_b: { sol: 1, sole: 1 } })).toEqual({
      char_a: { sole: 2 },
      char_b: { sol: 1, sole: 1 },
    })
  })

  it('folds axes onto ax when both ax and axe are held', () => {
    expect(normalize({ char_a: { axes: 2 }, char_b: { ax: 1, axe: 1 } })).toEqual({
      char_a: { ax: 2 },
      char_b: { ax: 1, axe: 1 },
    })
  })

  it('folds a multi-word key on its last word', () => {
    expect(normalize({ char_a: { 'Silver  Coins': 3 }, char_b: { 'silver coin': 2 } })).toEqual({
      char_a: { 'silver coin': 3 },
      char_b: { 'silver coin': 2 },
    })
  })

  it('folds each key one step, and a key another key folds onto stays put', () => {
    // bus receives buses, so this pass leaves it beside bu: no chain within one pass.
    expect(normalize({ char_a: { buses: 2, bus: 1, bu: 4 } })).toEqual({
      char_a: { bus: 3, bu: 4 },
    })
    // The receiver is on another record: the rule is branch-wide, not per record.
    expect(normalize({ char_a: { bus: 1, bu: 4 }, char_b: { buses: 2 } })).toEqual({
      char_a: { bus: 1, bu: 4 },
      char_b: { bus: 2 },
    })
  })

  it('drops blank keys and empty counts, and a dropped key is no fold target', () => {
    expect(
      normalize({ char_a: { ' ': 4, rope: 0, gold: 2 }, char_b: { arrows: 3, arrow: 0 } }),
    ).toEqual({ char_a: { gold: 2 }, char_b: { arrows: 3 } })
  })

  it('returns a record for every character, an absent one empty', () => {
    expect(normalize({ char_a: undefined, char_b: {} })).toEqual({ char_a: {}, char_b: {} })
  })

  it('keeps a key spelled __proto__ as an own key', () => {
    const record: Record<string, number> = JSON.parse('{"__proto__": 3, "gold": 1}')
    const out = normalizeStackables(new Map([['char_a', record]]))
    expect(Object.entries(out.get('char_a')!)).toEqual([
      ['__proto__', 3],
      ['gold', 1],
    ])
  })

  it('returns an already-normal record equal to its input', () => {
    const records = { char_a: { gold: 8, arrow: 3 }, char_b: { 'silver coin': 1 } }
    const out = normalizeStackables(new Map(Object.entries(records)))
    expect(sameStackables(out.get('char_a'), records.char_a)).toBe(true)
    expect(sameStackables(out.get('char_b'), records.char_b)).toBe(true)
  })
})

describe('sameStackables', () => {
  it('compares keys and counts in any order', () => {
    expect(sameStackables({ gold: 8, arrow: 3 }, { arrow: 3, gold: 8 })).toBe(true)
    expect(sameStackables({ gold: 8 }, { gold: 7 })).toBe(false)
    expect(sameStackables({ gold: 8 }, { Gold: 8 })).toBe(false)
    expect(sameStackables({ gold: 8 }, { gold: 8, arrow: 1 })).toBe(false)
    expect(sameStackables({ gold: 8, arrow: 1 }, { gold: 8 })).toBe(false)
  })

  it('reads an absent record as an empty one', () => {
    expect(sameStackables(undefined, {})).toBe(true)
    expect(sameStackables({}, undefined)).toBe(true)
    expect(sameStackables(undefined, undefined)).toBe(true)
    expect(sameStackables(undefined, { gold: 1 })).toBe(false)
  })
})
