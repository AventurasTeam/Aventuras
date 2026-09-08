import { describe, expect, it } from 'vitest'

import { entityNameIndexFrom, matchTerms, normalizeTerm, parseKeywords } from './name-index'

const named = (...names: string[]) => names.map((name) => ({ name }))

describe('entityNameIndexFrom', () => {
  const index = entityNameIndexFrom(named('Kara Vex', 'Mira', 'The Hollow'))

  it('lowercases entity names', () => {
    expect(index.entityNames.has('kara vex')).toBe(true)
    expect(index.entityNames.has('mira')).toBe(true)
  })

  it('trims surrounding whitespace before storing a term', () => {
    const idx = entityNameIndexFrom(named('  Kara Vex  '))
    expect(idx.entityNames.has('kara vex')).toBe(true)
    expect(idx.entityNames.has('  kara vex  ')).toBe(false)
  })

  it('excludes whitespace-only entity names from the index', () => {
    const idx = entityNameIndexFrom(named('   '))
    expect(idx.entityNames.size).toBe(0)
  })

  it('normalizes differently-encoded names to the same term', () => {
    const nfc = 'caf\u00e9' // U+00E9, precomposed
    const nfd = 'cafe\u0301' // 'e' + U+0301 combining acute
    expect(nfc).not.toBe(nfd) // sanity: distinct code unit sequences for the same rendered text
    const idx = entityNameIndexFrom(named(nfc, nfd))
    expect(idx.entityNames.size).toBe(1)
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
    const nfc = 'caf\u00e9' // how entityNameIndexFrom stores it
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

// docs/memory/retrieval.md → Keyword scan surface.
describe('matchTerms — per-term script rule', () => {
  it('matches an unspaced Han term by substring', () => {
    // Japanese prose supplies no inter-word space to anchor a boundary against,
    // so the \p{L}\p{N} lookarounds can never fire inside it.
    expect(matchTerms('彼女は月光剣を抜いた。', [normalizeTerm('月光剣')])).toEqual(['月光剣'])
  })

  it('matches a kana term', () => {
    expect(matchTerms('カラたちは村へ戻った。', [normalizeTerm('カラ')])).toEqual(['カラ'])
  })

  it('matches a hangul term carrying an attached particle', () => {
    expect(matchTerms('그는 은빛검을 들었다.', [normalizeTerm('은빛검')])).toEqual(['은빛검'])
  })

  it('keeps boundary matching for Latin terms', () => {
    expect(matchTerms('he made a start on it', [normalizeTerm('art')])).toEqual([])
  })

  it('keeps boundary matching for Cyrillic terms', () => {
    expect(matchTerms('Незоя вошла', [normalizeTerm('зоя')])).toEqual([])
  })

  it('denies substring mode to a single-character term', () => {
    // One ideograph appears inside too much to carry signal.
    expect(matchTerms('彼女は月光剣を抜いた。', [normalizeTerm('剣')])).toEqual([])
  })

  // An internal space means the author supplied a delimiter, so the term keeps
  // boundary mode — in CJK prose it then matches only at a bracket, never mid-run.
  it('denies substring mode to a term the author already delimited', () => {
    expect(matchTerms('月光 剣。', [normalizeTerm('月光 剣')])).toEqual(['月光 剣'])
    expect(matchTerms('その月光 剣士', [normalizeTerm('月光 剣')])).toEqual([])
  })

  // A single CJK character must not drag a mostly-Latin term into substring
  // mode — the failure the per-term rule exists to prevent.
  it('denies substring mode to a term carrying a letter from another script', () => {
    expect(matchTerms('a veilstone月stone', [normalizeTerm('veilstone月')])).toEqual([])
  })

  it('counts characters, not UTF-16 units, at the two-character floor', () => {
    // U+20BB7 is one ideograph and two code units; length >= 2 would admit it.
    expect(matchTerms('彼は𠮷を見た。', [normalizeTerm('\u{20BB7}')])).toEqual([])
  })

  // Iterating UTF-16 units instead of code points leaves every char a lone surrogate
  // — neither Han nor letter — so an astral term would lose substring mode entirely.
  it('matches an astral ideograph pair by substring', () => {
    const term = '\u{20BB7}\u{20BB7}'
    expect(matchTerms(`彼は${term}を見た。`, [normalizeTerm(term)])).toEqual([term])
  })

  it('treats the ideographic space as an author-supplied delimiter', () => {
    // U+3000 is the space a CJK author actually types; ' ' alone misses it.
    expect(matchTerms('その月光\u3000剣士', [normalizeTerm('月光\u3000剣')])).toEqual([])
  })

  // escape() only runs on the boundary branch, so the term has to be one that stays there.
  it('escapes regex metacharacters in a term the script rule sends to boundaries', () => {
    expect(matchTerms('the vex*月 hummed', [normalizeTerm('vex*月')])).toEqual(['vex*月'])
    expect(matchTerms('the vexX月 hummed', [normalizeTerm('vex*月')])).toEqual([])
  })
})
