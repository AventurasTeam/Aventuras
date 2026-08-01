import { describe, expect, it, vi } from 'vitest'

import { buildNameKeywordIndex, matchTerms } from './name-index'

const queryAll = (rows: Record<string, unknown[][]>) =>
  vi.fn(async (sql: string, _params: unknown[]) =>
    sql.includes('FROM entities') ? rows.entities : rows.lore,
  )

const fixture = queryAll({
  entities: [['Kara Vex'], ['Mira'], ['The Hollow']],
  lore: [[JSON.stringify(['veilstone', 'amulet'])], [JSON.stringify(['the Aetherium'])]],
})

describe('buildNameKeywordIndex', () => {
  it('lowercases entity names', async () => {
    const idx = await buildNameKeywordIndex(fixture, 'br_1')
    expect(idx.entityNames.has('kara vex')).toBe(true)
    expect(idx.entityNames.has('mira')).toBe(true)
  })

  it('lowercases lore keywords', async () => {
    const idx = await buildNameKeywordIndex(fixture, 'br_1')
    expect(idx.loreKeywords.has('veilstone')).toBe(true)
    expect(idx.loreKeywords.has('the aetherium')).toBe(true)
  })

  it('trims surrounding whitespace before storing a term', async () => {
    const padded = queryAll({
      entities: [['  Kara Vex  ']],
      lore: [[JSON.stringify(['  veilstone  '])]],
    })
    const idx = await buildNameKeywordIndex(padded, 'br_1')
    expect(idx.entityNames.has('kara vex')).toBe(true)
    expect(idx.entityNames.has('  kara vex  ')).toBe(false)
    expect(idx.loreKeywords.has('veilstone')).toBe(true)
    expect(idx.loreKeywords.has('  veilstone  ')).toBe(false)
  })

  it('excludes whitespace-only entity names and lore keywords from the index', async () => {
    const whitespaceOnly = queryAll({
      entities: [['   ']],
      lore: [[JSON.stringify(['   '])]],
    })
    const idx = await buildNameKeywordIndex(whitespaceOnly, 'br_1')
    expect(idx.entityNames.size).toBe(0)
    expect(idx.loreKeywords.size).toBe(0)
  })

  it('normalizes differently-encoded names and keywords to the same term', async () => {
    const nfc = 'caf\u00e9' // U+00E9, precomposed
    const nfd = 'cafe\u0301' // 'e' + U+0301 combining acute
    expect(nfc).not.toBe(nfd) // sanity: distinct code unit sequences for the same rendered text
    const mixed = queryAll({
      entities: [[nfc], [nfd]],
      lore: [[JSON.stringify([nfc])], [JSON.stringify([nfd])]],
    })
    const idx = await buildNameKeywordIndex(mixed, 'br_1')
    expect(idx.entityNames.size).toBe(1)
    expect(idx.loreKeywords.size).toBe(1)
  })

  it('tolerates a malformed keywords blob rather than failing the turn', async () => {
    const bad = queryAll({ entities: [], lore: [['not json']] })
    const idx = await buildNameKeywordIndex(bad, 'br_1')
    expect(idx.loreKeywords.size).toBe(0)
  })

  it('tolerates well-formed JSON that is not an array', async () => {
    const notAnArray = queryAll({ entities: [], lore: [[JSON.stringify({ veilstone: true })]] })
    const idx = await buildNameKeywordIndex(notAnArray, 'br_1')
    expect(idx.loreKeywords.size).toBe(0)
  })

  it('scopes both the entity and lore queries to the given branch', async () => {
    const tracked = queryAll({ entities: [], lore: [] })
    await buildNameKeywordIndex(tracked, 'br_42')
    expect(tracked.mock.calls).toHaveLength(2)
    for (const [sql, params] of tracked.mock.calls) {
      expect(sql).toMatch(/branch_id\s*=\s*\?/)
      expect(params).toEqual(['br_42'])
    }
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
    const nfc = 'caf\u00e9' // how buildNameKeywordIndex stores it
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
