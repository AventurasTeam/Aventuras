import { describe, expect, it } from 'vitest'

import type { ListModule } from './list-module'
import { planReveal } from './reveal-plan'

type Row = { id: string; tier: 'a' | 'b'; name: string }
type Filter = 'all' | 'a' | 'b'

const query: ListModule<Row, Filter, null, 'a' | 'b'>['query'] = (rows, input) =>
  rows.filter(
    (r) => (input.filter === 'all' || r.tier === input.filter) && r.name.includes(input.search),
  )

const copy: ListModule<Row, Filter, null, 'a' | 'b'>['copy'] = () => ({
  searchPlaceholder: '',
  searchScope: [],
  filterLabel: (f) => f,
  emptyTitle: '',
  emptySubtext: '',
  noResults: '',
  noResultsHint: '',
})

const listModule: ListModule<Row, Filter, null, 'a' | 'b'> = {
  filters: () => ['all', 'a', 'b'],
  query,
  grouping: {
    group: (rows) => ({
      pinned: null,
      groups: (['a', 'b'] as const)
        .map((tier) => ({ key: tier, rows: rows.filter((r) => r.tier === tier) }))
        .filter((g) => g.rows.length > 0),
    }),
    label: (key) => key,
  },
  copy,
  Row: () => null,
}

/** No grouping at all: `planReveal` never has a group to expand. */
const flatModule: ListModule<Row, Filter, null, 'a' | 'b'> = {
  filters: () => ['all', 'a', 'b'],
  query,
  grouping: null,
  copy,
  Row: () => null,
}

/** The row is both the pinned lead and a member of its own group — pinned wins. */
const pinnedAndGroupedModule: ListModule<Row, Filter, null, 'a' | 'b'> = {
  filters: () => ['all', 'a', 'b'],
  query,
  grouping: {
    group: (rows) => ({
      pinned: rows[0] ?? null,
      groups: (['a', 'b'] as const)
        .map((tier) => ({ key: tier, rows: rows.filter((r) => r.tier === tier) }))
        .filter((g) => g.rows.length > 0),
    }),
    label: (key) => key,
  },
  copy,
  Row: () => null,
}

const row: Row = { id: 'r1', tier: 'b', name: 'Brannoc' }

describe('planReveal', () => {
  it('expands the row group on the All view without widening', () => {
    const plan = planReveal({
      listModule,
      row,
      view: { search: '', filter: 'all' },
      allFilter: 'all',
      signals: null,
    })
    expect(plan).toEqual({ widen: false, expandGroup: 'b' })
  })

  it('leaves a listed row alone under a narrowing chip', () => {
    const plan = planReveal({
      listModule,
      row,
      view: { search: '', filter: 'b' },
      allFilter: 'all',
      signals: null,
    })
    expect(plan).toEqual({ widen: false, expandGroup: null })
  })

  it('widens and expands when the chip or search hides the row', () => {
    expect(
      planReveal({
        listModule,
        row,
        view: { search: '', filter: 'a' },
        allFilter: 'all',
        signals: null,
      }),
    ).toEqual({ widen: true, expandGroup: 'b' })
    expect(
      planReveal({
        listModule,
        row,
        view: { search: 'zzz', filter: 'all' },
        allFilter: 'all',
        signals: null,
      }),
    ).toEqual({ widen: true, expandGroup: 'b' })
  })

  it('never expands a group in a flat module: widens only when hidden', () => {
    expect(
      planReveal({
        listModule: flatModule,
        row,
        view: { search: 'zzz', filter: 'all' },
        allFilter: 'all',
        signals: null,
      }),
    ).toEqual({ widen: true, expandGroup: null })
    expect(
      planReveal({
        listModule: flatModule,
        row,
        view: { search: '', filter: 'all' },
        allFilter: 'all',
        signals: null,
      }),
    ).toEqual({ widen: false, expandGroup: null })
  })

  it('never expands a group for a row that is also pinned', () => {
    const plan = planReveal({
      listModule: pinnedAndGroupedModule,
      row,
      view: { search: '', filter: 'all' },
      allFilter: 'all',
      signals: null,
    })
    expect(plan).toEqual({ widen: false, expandGroup: null })
  })
})
