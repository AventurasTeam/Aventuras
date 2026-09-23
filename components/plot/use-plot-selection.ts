import { useCallback, useEffect, useMemo, useState } from 'react'

import type { Happening, Thread } from '@/lib/db'
import type { PlotKind } from '@/lib/list-modules'

export type PlotDetailSelection =
  | { type: 'thread'; row: Thread }
  | { type: 'happening'; row: Happening }
  /** `seq` changes on every `[+] Blank`, so a repeat create resets a draft already in create mode. */
  | { type: 'create'; kind: PlotKind; seq: number }

type PlotSelectionInput = {
  initialId: string | null
  kind: PlotKind
  threads: readonly Thread[]
  happenings: readonly Happening[]
  /** False until the story's rows are hydrated; an id that doesn't resolve is kept until then. */
  ready: boolean
}

/** Plot's selected row, or create mode; a row that disappears takes its selection with it. */
export function usePlotSelection({
  initialId,
  kind,
  threads,
  happenings,
  ready,
}: PlotSelectionInput) {
  const [selectedId, setSelectedId] = useState<string | null>(initialId)
  const [creating, setCreating] = useState(false)
  const [createSeq, setCreateSeq] = useState(0)

  const selection = useMemo<PlotDetailSelection | null>(() => {
    if (creating) return { type: 'create', kind, seq: createSeq }
    if (selectedId == null) return null
    if (kind === 'thread') {
      const row = threads.find((r) => r.id === selectedId)
      return row == null ? null : { type: 'thread', row }
    }
    const row = happenings.find((r) => r.id === selectedId)
    return row == null ? null : { type: 'happening', row }
  }, [creating, createSeq, selectedId, kind, threads, happenings])

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

  return { selectedId, creating, selection, select, startCreate }
}
