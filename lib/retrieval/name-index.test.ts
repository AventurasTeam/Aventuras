import { describe, expect, it } from 'vitest'

import { buildNameKeywordIndex, matchTerms } from './name-index'

const queryAll = (rows: Record<string, unknown[][]>) => async (sql: string) =>
  sql.includes('FROM entities') ? rows.entities : rows.lore

const fixture = queryAll({
  entities: [
    ['char_a', 'Kara Vex', 'active'],
    ['char_b', 'Mira', 'staged'],
    ['loc_a', 'The Hollow', 'active'],
  ],
  lore: [
    ['lore_a', JSON.stringify(['veilstone', 'amulet'])],
    ['lore_b', JSON.stringify(['the Aetherium'])],
  ],
})

describe('buildNameKeywordIndex', () => {
  it('lowercases entity names and keeps the id and status', async () => {
    const idx = await buildNameKeywordIndex(fixture, 'br_1')
    expect(idx.entityNames.get('kara vex')).toEqual([{ id: 'char_a', status: 'active' }])
    expect(idx.entityNames.get('mira')).toEqual([{ id: 'char_b', status: 'staged' }])
  })

  it('groups same-named entities under one term', async () => {
    const dupes = queryAll({
      entities: [
        ['char_a', 'Mira', 'active'],
        ['char_b', 'Mira', 'staged'],
      ],
      lore: [],
    })
    const idx = await buildNameKeywordIndex(dupes, 'br_1')
    expect(idx.entityNames.get('mira')).toHaveLength(2)
  })

  it('lowercases lore keywords and maps them to their row', async () => {
    const idx = await buildNameKeywordIndex(fixture, 'br_1')
    expect(idx.loreKeywords.get('veilstone')).toEqual(['lore_a'])
    expect(idx.loreKeywords.get('the aetherium')).toEqual(['lore_b'])
  })

  it('groups a shared keyword under every lore row that carries it', async () => {
    const shared = queryAll({
      entities: [],
      lore: [
        ['lore_a', JSON.stringify(['veilstone'])],
        ['lore_b', JSON.stringify(['veilstone'])],
      ],
    })
    const idx = await buildNameKeywordIndex(shared, 'br_1')
    expect(idx.loreKeywords.get('veilstone')).toEqual(['lore_a', 'lore_b'])
  })

  it('tolerates a malformed keywords blob rather than failing the turn', async () => {
    const bad = queryAll({ entities: [], lore: [['lore_x', 'not json']] })
    const idx = await buildNameKeywordIndex(bad, 'br_1')
    expect(idx.loreKeywords.size).toBe(0)
  })

  it('tolerates well-formed JSON that is not an array', async () => {
    const notAnArray = queryAll({
      entities: [],
      lore: [['lore_x', JSON.stringify({ veilstone: true })]],
    })
    const idx = await buildNameKeywordIndex(notAnArray, 'br_1')
    expect(idx.loreKeywords.size).toBe(0)
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
  })
})
