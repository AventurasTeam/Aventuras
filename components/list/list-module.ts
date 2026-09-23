import type { ComponentType, Ref } from 'react'
import type { View } from 'react-native'

import type { CollisionListRowProps } from '@/components/compounds/collision-list-row'
import type { ListGrouping, ListQuery } from '@/lib/list-modules'
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

export type RowRendererProps<Row, Signals = unknown> = {
  row: Row
  selected: boolean
  onPress: () => void
  signals: RowSignals
  /** The module's list-level signals, for a row whose rendering depends on list-wide state. */
  listSignals: Signals
  /** `compact` drops the description line for the rail's narrower column. */
  density?: RowDensity
  /** Goes on the row's pressable, so a reveal can move focus to it. */
  focusRef?: Ref<View>
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
  Signals,
  GroupKey extends string = string,
> = {
  /**
   * Chip vocabulary in render order; return a stable module-level array, not a fresh literal —
   * consumers may key effects on it. Empty hides the chip row.
   */
  filters: (signals: Signals) => readonly Filter[]
  /** A row's inclusion never depends on the other rows. */
  query: (rows: readonly Row[], input: ListQuery<Filter>, signals: Signals) => Row[]
  /**
   * The All view's ordered, non-empty groups plus an optional pinned row; null when ungrouped.
   * A row's group key/pin never depends on the others; a pinned row is excluded from every
   * group (`renderOrder` assumes it), and `planReveal` targets one row.
   */
  grouping: {
    group: (rows: readonly Row[], signals: Signals) => ListGrouping<Row, GroupKey>
    label: (key: GroupKey) => string
  } | null
  copy: (categoryLabel: string) => ListCopy<Filter>
  Row: ComponentType<RowRendererProps<Row, Signals>>
}

export type ArrangedRows<Row, GroupKey extends string> = {
  visible: Row[]
  /** The All view's groups; null under a narrowing chip or for a module without grouping. */
  grouped: (ListGrouping<Row, GroupKey> & { label: (key: GroupKey) => string }) | null
}

/** A module's list for one view, as `ModuleList` renders it. */
export function arrangeRows<
  Row extends { id: string },
  Filter extends string,
  Signals,
  GroupKey extends string,
>(
  listModule: ListModule<Row, Filter, Signals, GroupKey>,
  rows: readonly Row[],
  view: ListQuery<Filter>,
  signals: Signals,
): ArrangedRows<Row, GroupKey> {
  const visible = listModule.query(rows, view, signals)
  const grouping = listModule.grouping
  if (view.filter !== 'all' || grouping == null) return { visible, grouped: null }
  return { visible, grouped: { ...grouping.group(visible, signals), label: grouping.label } }
}

/** The rows top to bottom: the pinned row, then each group's rows; flat when ungrouped. */
export function renderOrder<Row, GroupKey extends string>({
  visible,
  grouped,
}: ArrangedRows<Row, GroupKey>): Row[] {
  if (grouped == null) return visible
  return [
    ...(grouped.pinned == null ? [] : [grouped.pinned]),
    ...grouped.groups.flatMap((g) => g.rows),
  ]
}
