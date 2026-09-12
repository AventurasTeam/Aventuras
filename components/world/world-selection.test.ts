import { describe, expect, it } from 'vitest'

import { parseWorldSelection, worldAddLabel, worldCategoryLabel } from './world-selection'

describe('parseWorldSelection', () => {
  it('parses kind + id, carrying tab when present', () => {
    expect(parseWorldSelection({ kind: 'character', id: 'char_1' })).toEqual({
      category: 'character',
      id: 'char_1',
    })
    expect(parseWorldSelection({ kind: 'lore', id: 'lore_1', tab: 'body' })).toEqual({
      category: 'lore',
      id: 'lore_1',
      tab: 'body',
    })
  })

  it('returns null for an unknown kind, a missing or empty id, or a repeated kind', () => {
    expect(parseWorldSelection({ kind: 'thread', id: 'thr_1' })).toBeNull()
    expect(parseWorldSelection({ kind: 'character' })).toBeNull()
    expect(parseWorldSelection({ kind: 'character', id: '' })).toBeNull()
    expect(parseWorldSelection({ kind: ['character', 'lore'], id: 'x' })).toBeNull()
    expect(parseWorldSelection({})).toBeNull()
  })

  it('drops a repeated tab, keeping the rest of the selection', () => {
    expect(parseWorldSelection({ kind: 'lore', id: 'l', tab: ['a', 'b'] })).toEqual({
      category: 'lore',
      id: 'l',
    })
  })
})

describe('labels', () => {
  it('resolves the surface-owned category and add labels', () => {
    expect(worldCategoryLabel('location')).toBe('Locations')
    expect(worldAddLabel('lore')).toBe('New lore')
  })
})
