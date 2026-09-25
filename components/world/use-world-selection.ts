import { useCallback, useEffect, useMemo, useState } from 'react'

import type { Entity, EntityKind, Lore } from '@/lib/db'
import { isEntityCategory, type WorldCategory } from '@/lib/list-modules'

export type WorldDetailSelection =
  | { type: 'entity'; row: Entity }
  | { type: 'lore'; row: Lore }
  /** `seq` bumps per `[+] Blank`, so a repeat create resets a draft already in create mode. */
  | { type: 'create'; kind: EntityKind; seq: number }

type WorldSelectionInput = {
  initialId: string | null
  category: WorldCategory
  entities: readonly Entity[]
  lore: readonly Lore[]
  /** False until the story's rows are hydrated; an id that doesn't resolve is kept until then. */
  ready: boolean
}

/** World's selected row, or create mode; a row that disappears takes its selection with it. */
export function useWorldSelection({
  initialId,
  category,
  entities,
  lore,
  ready,
}: WorldSelectionInput) {
  const [selectedId, setSelectedId] = useState<string | null>(initialId)
  const [creating, setCreating] = useState(false)
  const [createSeq, setCreateSeq] = useState(0)

  const selection = useMemo<WorldDetailSelection | null>(() => {
    if (creating && isEntityCategory(category))
      return { type: 'create', kind: category, seq: createSeq }
    if (selectedId == null) return null
    if (isEntityCategory(category)) {
      const row = entities.find((e) => e.id === selectedId && e.kind === category)
      return row == null ? null : { type: 'entity', row }
    }
    const row = lore.find((l) => l.id === selectedId)
    return row == null ? null : { type: 'lore', row }
  }, [creating, createSeq, selectedId, category, entities, lore])

  // A row that disappears (an undo, a reversed run) takes its selection with it, so a
  // restore under the same id can't reopen the detail on its own.
  useEffect(() => {
    if (ready && !creating && selectedId != null && selection == null) setSelectedId(null)
  }, [ready, creating, selectedId, selection])

  const select = useCallback((id: string | null) => {
    setCreating(false)
    setSelectedId(id)
  }, [])
  const startCreate = useCallback(() => {
    setSelectedId(null)
    setCreating(true)
    setCreateSeq((n) => n + 1)
  }, [])

  return { selectedId, selection, select, startCreate }
}
