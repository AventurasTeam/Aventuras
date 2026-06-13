import { describe, expect, it } from 'vitest'

import type { Story as StoryRow } from '@/lib/db'

import { selectStoryCards, type StoryListQuery } from './selectors'

const NOW = 5_000_000

function row(p: Partial<StoryRow> & { id: string }): StoryRow {
  return {
    title: p.id,
    description: null,
    tags: [],
    coverAssetId: null,
    accentColor: null,
    status: 'active',
    favorite: 0,
    lastOpenedAt: null,
    definition: null,
    settings: null,
    createdAt: 1,
    updatedAt: 1,
    currentBranchId: null,
    ...p,
  } as StoryRow
}

const Q = (partial: Partial<StoryListQuery> = {}): StoryListQuery => ({
  search: '',
  filter: 'all',
  sort: 'last-opened',
  ...partial,
})

const ids = (rows: StoryRow[], q: StoryListQuery) => selectStoryCards(rows, q, NOW).map((c) => c.id)

describe('selectStoryCards', () => {
  it('All hides archived; favorites float first', () => {
    const rows = [
      row({ id: 'a', lastOpenedAt: 100 }),
      row({ id: 'fav', favorite: 1, lastOpenedAt: 50 }),
      row({ id: 'arch', status: 'archived', lastOpenedAt: 200 }),
    ]
    expect(ids(rows, Q())).toEqual(['fav', 'a']) // arch hidden, fav first despite older last-open
  })

  it('Favorited shows only non-archived favorites', () => {
    const rows = [
      row({ id: 'f1', favorite: 1 }),
      row({ id: 'f-arch', favorite: 1, status: 'archived' }),
      row({ id: 'plain' }),
    ]
    expect(ids(rows, Q({ filter: 'favorited' }))).toEqual(['f1'])
  })

  it('Archived shows only archived', () => {
    const rows = [row({ id: 'a' }), row({ id: 'x', status: 'archived' })]
    expect(ids(rows, Q({ filter: 'archived' }))).toEqual(['x'])
  })

  it('sorts last-opened desc with nulls last, beneath favorite layer', () => {
    const rows = [
      row({ id: 'never', lastOpenedAt: null }),
      row({ id: 'old', lastOpenedAt: 10 }),
      row({ id: 'new', lastOpenedAt: 99 }),
    ]
    expect(ids(rows, Q({ sort: 'last-opened' }))).toEqual(['new', 'old', 'never'])
  })

  it('sorts created desc and title asc', () => {
    const rows = [
      row({ id: 'a', title: 'Zed', createdAt: 1 }),
      row({ id: 'b', title: 'alpha', createdAt: 9 }),
    ]
    expect(ids(rows, Q({ sort: 'created' }))).toEqual(['b', 'a'])
    expect(ids(rows, Q({ sort: 'title' }))).toEqual(['b', 'a']) // alpha < Zed, case-insensitive
  })

  it('searches title, description, genre label, and tags (case-insensitive)', () => {
    const rows = [
      row({ id: 'byTitle', title: 'Ironclad' }),
      row({ id: 'byDesc', description: 'an IRON saga' }),
       
      row({ id: 'byGenre', definition: { genre: { label: 'Iron Fantasy' } } as any }),
      row({ id: 'byTag', tags: ['steampunk', 'iron'] }),
      row({ id: 'miss', title: 'Cozy' }),
    ]
    expect(ids(rows, Q({ search: 'iron' })).sort()).toEqual(
      ['byDesc', 'byGenre', 'byTag', 'byTitle'].sort(),
    )
  })
})
