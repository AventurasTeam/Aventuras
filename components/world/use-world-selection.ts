import { useEffect, useMemo, useState } from 'react'

import type { Entity, Lore } from '@/lib/db'
import { isEntityCategory, type WorldCategory } from '@/lib/list-modules'

import type { WorldDetailSelection } from './world-detail-placeholder'

type WorldSelectionInput = {
  initialId: string | null
  category: WorldCategory
  entities: readonly Entity[]
  lore: readonly Lore[]
  /** False until the story's rows are hydrated; an id that doesn't resolve is kept until then. */
  ready: boolean
}

/** World's selected row: the id, and the current category's row it resolves to. */
export function useWorldSelection({
  initialId,
  category,
  entities,
  lore,
  ready,
}: WorldSelectionInput) {
  const [selectedId, setSelectedId] = useState<string | null>(initialId)
  const selection = useMemo<WorldDetailSelection | null>(() => {
    if (selectedId == null) return null
    if (isEntityCategory(category)) {
      const row = entities.find((e) => e.id === selectedId && e.kind === category)
      return row == null ? null : { category, row }
    }
    const row = lore.find((l) => l.id === selectedId)
    return row == null ? null : { category: 'lore', row }
  }, [selectedId, category, entities, lore])

  // A row that disappears (an undo, a reversed run) takes its selection with it, so a
  // restore under the same id can't reopen the detail on its own.
  useEffect(() => {
    if (ready && selectedId != null && selection == null) setSelectedId(null)
  }, [ready, selectedId, selection])

  return { selectedId, setSelectedId, selection }
}
