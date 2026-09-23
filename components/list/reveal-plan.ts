import type { ListQuery } from '@/lib/list-modules'

import type { ListModule } from './list-module'

export type RevealPlan<Key extends string> = {
  /** The chip or search hides the row: reset both before scrolling. */
  widen: boolean
  /** The All view's group to expand so the row mounts; null when flat or pinned. */
  expandGroup: Key | null
}

/** What the owner changes before it scrolls to `row` (world.md → Surfacing). */
export function planReveal<
  Row extends { id: string },
  Filter extends string,
  Signals,
  Key extends string,
>(args: {
  listModule: ListModule<Row, Filter, Signals, Key>
  row: Row
  view: ListQuery<Filter>
  /** Must be the value `arrangeRows` treats as the All view — its check is hardcoded to `'all'`. */
  allFilter: Extract<Filter, 'all'>
  signals: Signals
}): RevealPlan<Key> {
  const { listModule, row, view, allFilter, signals } = args
  const listed = listModule.query([row], view, signals).length > 0
  const grouping = listModule.grouping
  // Under a narrowing chip the list is flat; only the All view's groups can hide a listed row.
  if (grouping == null || (listed && view.filter !== allFilter)) {
    return { widen: !listed, expandGroup: null }
  }
  const { pinned, groups } = grouping.group([row], signals)
  return { widen: !listed, expandGroup: pinned == null ? (groups[0]?.key ?? null) : null }
}
