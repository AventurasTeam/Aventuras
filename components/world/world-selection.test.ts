import { describe, expect, it } from 'vitest'

import {
  parseWorldSelection,
  worldAddLabel,
  worldCategoryLabel,
  worldHref,
} from './world-selection'

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

describe('worldHref', () => {
  const query = (href: string) => Object.fromEntries(new URLSearchParams(href.split('?')[1]))

  it('builds the route with the link as its query, round-tripping through the parser', () => {
    const link = { category: 'character', id: 'char_kael', tab: 'connections' } as const
    const href = worldHref('br_1', link)
    expect(href.split('?')[0]).toBe('/world/br_1')
    expect(parseWorldSelection(query(href))).toEqual(link)
  })

  it('leaves out a tab the link has none of', () => {
    expect(worldHref('br_1', { category: 'lore', id: 'lore_1' })).toBe(
      '/world/br_1?kind=lore&id=lore_1',
    )
  })
})
