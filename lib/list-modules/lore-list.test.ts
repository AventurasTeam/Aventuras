import { describe, expect, it } from 'vitest'

import { makeLore } from './__tests__/fixtures'
import { compareLore, matchesLoreSearch, queryLore } from './lore-list'

describe('lore list', () => {
  it('searches title, body, category and tags', () => {
    const row = makeLore({
      id: 'lore_1',
      title: 'The Veil',
      body: 'A membrane between the city and what it contains.',
      category: 'cosmology',
      tags: ['magic'],
    })
    expect(matchesLoreSearch(row, 'veil')).toBe(true)
    expect(matchesLoreSearch(row, 'membrane')).toBe(true)
    expect(matchesLoreSearch(row, 'COSMOLOGY')).toBe(true)
    expect(matchesLoreSearch(row, 'magic')).toBe(true)
    expect(matchesLoreSearch(row, 'syndicate')).toBe(false)
  })

  it('sorts by priority desc then title', () => {
    const rows = [
      makeLore({ id: 'b', title: 'Beta', priority: 5 }),
      makeLore({ id: 'a', title: 'Alpha', priority: 5 }),
      makeLore({ id: 'z', title: 'Zeta', priority: 10 }),
    ]
    expect(queryLore(rows, { search: '' }).map((r) => r.id)).toEqual(['z', 'a', 'b'])
  })

  it('breaks a title tie by createdAt under base-sensitivity collation', () => {
    const veilLower = makeLore({ id: 'a', title: 'veil', priority: 1, createdAt: 2 })
    const veilUpper = makeLore({ id: 'b', title: 'Veil', priority: 1, createdAt: 1 })
    const sorted = [veilLower, veilUpper].sort(compareLore)
    expect(sorted.map((r) => r.title)).toEqual(['Veil', 'veil'])
  })

  it('breaks a full tie (same title, same createdAt) by id', () => {
    const higherId = makeLore({ id: 'b_id', title: 'Same', priority: 1, createdAt: 5 })
    const lowerId = makeLore({ id: 'a_id', title: 'Same', priority: 1, createdAt: 5 })
    expect(compareLore(higherId, lowerId)).toBeGreaterThan(0)
    expect(compareLore(lowerId, higherId)).toBeLessThan(0)
  })
})
