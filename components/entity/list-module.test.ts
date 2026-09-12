import { describe, expect, it } from 'vitest'

import type { ListGrouping } from '@/lib/list-modules'

import { arrangeRows, renderOrder, type ListModule } from './list-module'

type Row = { id: string; tier: 'a' | 'b' }

const ROWS: Row[] = [
  { id: 'a1', tier: 'a' },
  { id: 'lead', tier: 'b' },
  { id: 'b1', tier: 'b' },
  { id: 'a2', tier: 'a' },
]

function group(rows: readonly Row[]): ListGrouping<Row, 'a' | 'b'> {
  const pinned = rows.find((r) => r.id === 'lead') ?? null
  const rest = rows.filter((r) => r !== pinned)
  return {
    pinned,
    groups: (['a', 'b'] as const)
      .map((key) => ({ key, rows: rest.filter((r) => r.tier === key) }))
      .filter((g) => g.rows.length > 0),
  }
}

const MODULE: ListModule<Row, 'all' | 'a', null, 'a' | 'b'> = {
  filters: () => ['all', 'a'],
  query: (rows, { filter }) => rows.filter((r) => filter === 'all' || r.tier === filter),
  grouping: { group, label: (key) => key },
  copy: () => ({
    searchPlaceholder: '',
    searchScope: [],
    filterLabel: (filter) => filter,
    emptyTitle: '',
    emptySubtext: '',
    noResults: '',
    noResultsHint: '',
  }),
  Row: () => null,
}

const ids = (rows: readonly Row[]) => rows.map((r) => r.id)

describe('arrangeRows and renderOrder', () => {
  it('renders the All view pinned row first, then each group in order', () => {
    const arranged = arrangeRows(MODULE, ROWS, { search: '', filter: 'all' }, null)
    expect(arranged.grouped?.pinned?.id).toBe('lead')
    expect(ids(renderOrder(arranged))).toEqual(['lead', 'a1', 'a2', 'b1'])
  })

  it('keeps a narrowing chip flat', () => {
    const arranged = arrangeRows(MODULE, ROWS, { search: '', filter: 'a' }, null)
    expect(arranged.grouped).toBeNull()
    expect(ids(renderOrder(arranged))).toEqual(['a1', 'a2'])
  })

  it('keeps a module without grouping flat on the All view', () => {
    const ungrouped = { ...MODULE, grouping: null }
    const arranged = arrangeRows(ungrouped, ROWS, { search: '', filter: 'all' }, null)
    expect(arranged.grouped).toBeNull()
    expect(ids(renderOrder(arranged))).toEqual(['a1', 'lead', 'b1', 'a2'])
  })
})
