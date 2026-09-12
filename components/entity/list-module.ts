import type { ComponentType } from 'react'

import type { CollisionListRowProps } from '@/components/compounds/collision-list-row'
import type { EntityListSignals, ListGrouping, ListQuery } from '@/lib/list-modules'
import type { RecentlyClassified } from '@/lib/row-signals'

export type LeadLabel = 'you' | 'protagonist'

export type RowCollision = CollisionListRowProps['collision']

/** Every runtime-derived channel a row renders; the renderer reads no store. */
export type RowSignals = {
  lead?: LeadLabel | null
  inScene?: boolean
  recentlyClassified?: RecentlyClassified
  collision?: RowCollision
}

export type RowDensity = 'default' | 'compact'

export type RowRendererProps<Row> = {
  row: Row
  selected: boolean
  onPress: () => void
  signals: RowSignals
  /** `compact` drops the description line for the rail's narrower column. */
  density?: RowDensity
}

export type ListCopy<Filter extends string = string> = {
  searchPlaceholder: string
  /** Translated field names for the ⓘ scope popover. */
  searchScope: readonly string[]
  filterLabel: (filter: Filter) => string
  emptyTitle: string
  emptySubtext: string
  noResults: string
  noResultsHint: string
}

/**
 * The category label is surface-owned (World says Locations, the rail says Places) and passed in.
 */
export type ListModule<
  Row extends { id: string },
  Filter extends string,
  Signals = EntityListSignals,
  GroupKey extends string = string,
> = {
  /**
   * Chip vocabulary in render order; return a stable module-level array, not a fresh literal —
   * consumers may key effects on it. Empty hides the chip row.
   */
  filters: (signals: Signals) => readonly Filter[]
  query: (rows: readonly Row[], input: ListQuery<Filter>, signals: Signals) => Row[]
  /**
   * Groups `query`'s result into the All view's ordered, non-empty groups, plus an optional row
   * pinned above them; names each group key for display. Null when the kind has no grouping.
   */
  grouping: {
    group: (rows: readonly Row[], signals: Signals) => ListGrouping<Row, GroupKey>
    label: (key: GroupKey) => string
  } | null
  copy: (categoryLabel: string) => ListCopy<Filter>
  Row: ComponentType<RowRendererProps<Row>>
}
