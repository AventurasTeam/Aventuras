import { describe, expect, it } from 'vitest'

import { matchTerms, nameKeywordIndexFrom, parseKeywords } from './name-index'

const named = (...names: string[]) => names.map((name) => ({ name }))
const keyworded = (...lists: string[][]) => lists.map((keywords) => ({ keywords }))

describe('nameKeywordIndexFrom', () => {
  const index = nameKeywordIndexFrom(
    named('Kara Vex', 'Mira', 'The Hollow'),
    keyworded(['veilstone', 'amulet'], ['the Aetherium']),
  )

  it('lowercases entity names', () => {
    expect(index.entityNames.has('kara vex')).toBe(true)
    expect(index.entityNames.has('mira')).toBe(true)
  })

  it('lowercases lore keywords', () => {
    expect(index.loreKeywords.has('veilstone')).toBe(true)
    expect(index.loreKeywords.has('the aetherium')).toBe(true)
  })

  it('trims surrounding whitespace before storing a term', () => {
    const idx = nameKeywordIndexFrom(named('  Kara Vex  '), keyworded(['  veilstone  ']))
    expect(idx.entityNames.has('kara vex')).toBe(true)
    expect(idx.entityNames.has('  kara vex  ')).toBe(false)
    expect(idx.loreKeywords.has('veilstone')).toBe(true)
    expect(idx.loreKeywords.has('  veilstone  ')).toBe(false)
  })

  it('excludes whitespace-only entity names and lore keywords from the index', () => {
    const idx = nameKeywordIndexFrom(named('   '), keyworded(['   ']))
    expect(idx.entityNames.size).toBe(0)
    expect(idx.loreKeywords.size).toBe(0)
  })

  it('normalizes differently-encoded names and keywords to the same term', () => {
    const nfc = 'caf\u00e9' // U+00E9, precomposed
    const nfd = 'cafe\u0301' // 'e' + U+0301 combining acute
    expect(nfc).not.toBe(nfd) // sanity: distinct code unit sequences for the same rendered text
    const idx = nameKeywordIndexFrom(named(nfc, nfd), keyworded([nfc], [nfd]))
    expect(idx.entityNames.size).toBe(1)
    expect(idx.loreKeywords.size).toBe(1)
  })
})

describe('parseKeywords', () => {
  it('reads a well-formed JSON string array', () => {
    expect(parseKeywords(JSON.stringify(['veilstone', 'amulet']))).toEqual(['veilstone', 'amulet'])
  })

  it('tolerates a malformed keywords blob rather than failing the turn', () => {
    expect(parseKeywords('not json')).toEqual([])
  })

  it('tolerates well-formed JSON that is not an array', () => {
    expect(parseKeywords(JSON.stringify({ veilstone: true }))).toEqual([])
  })

  it('drops non-string members rather than indexing them', () => {
    expect(parseKeywords(JSON.stringify(['veilstone', 7, null, 'amulet']))).toEqual([
      'veilstone',
      'amulet',
    ])
  })

  it('reads a null column as no keywords', () => {
    expect(parseKeywords(null)).toEqual([])
  })
})

describe('matchTerms', () => {
  const terms = new Set(['kara vex', 'mira', 'veilstone'])

  it('finds a term on a word boundary regardless of case', () => {
    expect(matchTerms('Kara Vex drew the blade.', terms)).toEqual(['kara vex'])
  })

  it('does not match a term embedded inside a longer word', () => {
    // 'Miracle' must not surface the staged entity 'Mira' — a substring match
    // here would fire Layer-A suppression on ordinary prose.
    expect(matchTerms('A miracle, she said.', terms)).toEqual([])
  })

  it('returns each matched term once even on repeats', () => {
    expect(matchTerms('veilstone, veilstone, veilstone', terms)).toEqual(['veilstone'])
  })

  it('matches accented and non-Latin names, unlike plain ASCII \\b', () => {
    expect(matchTerms('Zoë walked into the room.', new Set(['zoë']))).toEqual(['zoë'])
    expect(matchTerms('Зоя вошла в комнату.', new Set(['зоя']))).toEqual(['зоя'])
  })

  it('matches when prose uses a different Unicode normalization form than the stored term', () => {
    const nfc = 'caf\u00e9' // how nameKeywordIndexFrom stores it
    const nfd = 'cafe\u0301' // how an LLM might render the same word
    expect(nfc).not.toBe(nfd) // sanity: distinct code unit sequences
    expect(matchTerms(`the ${nfd} closed early`, new Set([nfc]))).toEqual([nfc])
  })

  it('never matches on an empty term', () => {
    expect(matchTerms('A miracle, she said.', new Set(['']))).toEqual([])
  })

  it('rejects a term glued onto a preceding letter, not just a following one', () => {
    expect(matchTerms('Xmira walked by.', new Set(['mira']))).toEqual([])
  })

  it('escapes regex metacharacters in terms so they match literally', () => {
    // Unescaped, '*hollow*' is an invalid quantifier and throws mid-turn;
    // unescaped, '(the elder)' silently becomes a capture group and never matches.
    expect(matchTerms('The *Hollow* trembled.', new Set(['*hollow*']))).toEqual(['*hollow*'])
    expect(matchTerms('Vex (the Elder) spoke.', new Set(['vex (the elder)']))).toEqual([
      'vex (the elder)',
    ])
  })

  it('accepts a one-shot iterator, matching the shape every call site passes', () => {
    expect(matchTerms('Kara Vex met Mira near the veilstone.', terms.values())).toEqual([
      'kara vex',
      'mira',
      'veilstone',
    ])
  })
})
