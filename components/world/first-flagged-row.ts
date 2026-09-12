import { entityListModule } from '@/components/entity/entity-list-module'
import type { Entity, EntityKind } from '@/lib/db'
import {
  isEntityCategory,
  WORLD_CATEGORIES,
  type EntityFilter,
  type EntityListSignals,
  type ListQuery,
  type WorldCategory,
} from '@/lib/list-modules'

const ALL_VIEW: ListQuery<EntityFilter> = { search: '', filter: 'all' }

// Mirrors ModuleList's render order: All view groups, pinned row first; chip view is flat.
function listOrder(
  kind: EntityKind,
  entities: readonly Entity[],
  view: ListQuery<EntityFilter>,
  signals: EntityListSignals,
): Entity[] {
  const listModule = entityListModule(kind)
  const rows = listModule.query(entities, view, signals)
  if (view.filter !== 'all' || listModule.grouping == null) return rows
  const { pinned, groups } = listModule.grouping.group(rows, signals)
  return [...(pinned == null ? [] : [pinned]), ...groups.flatMap((g) => g.rows)]
}

type FirstFlaggedRowInput = {
  entities: readonly Entity[]
  flagged: { has: (id: string) => boolean }
  /** The pane's current category and view; any other kind is searched in its All view. */
  category: WorldCategory
  view: ListQuery<EntityFilter>
  signals: EntityListSignals
}

/**
 * The review pill's target: first flagged row in list order — current view first (so an
 * active chip/search still surfaces it), then the kind's All view, then other kinds.
 * Null when nothing is flagged.
 */
export function firstFlaggedRow({
  entities,
  flagged,
  category,
  view,
  signals,
}: FirstFlaggedRowInput): Entity | null {
  const attempts: { kind: EntityKind; view: ListQuery<EntityFilter> }[] = []
  if (isEntityCategory(category)) {
    attempts.push({ kind: category, view }, { kind: category, view: ALL_VIEW })
  }
  for (const kind of WORLD_CATEGORIES.filter(isEntityCategory)) {
    if (kind !== category) attempts.push({ kind, view: ALL_VIEW })
  }
  for (const attempt of attempts) {
    const row = listOrder(attempt.kind, entities, attempt.view, signals).find((e) =>
      flagged.has(e.id),
    )
    if (row != null) return row
  }
  return null
}
