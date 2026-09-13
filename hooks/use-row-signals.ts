import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { db, type EntityKind } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import {
  latestReplyIds,
  readReplyEdits,
  readSignalDeltas,
  readTurnBoundaries,
  selectInScene,
  selectRecentlyClassified,
  type RecentlyClassifiedSignals,
  type ReplyEdit,
  type SignalDelta,
  type SignalEntry,
  type TurnBoundaries,
} from '@/lib/row-signals'
import { entitiesStore, entriesStore, generationStore } from '@/lib/stores'

export type RowSignalsSnapshot = {
  recentlyClassified: RecentlyClassifiedSignals
  inScene: ReadonlySet<string>
}

const EMPTY_SIGNALS: RecentlyClassifiedSignals = { rows: new Map(), byCategory: new Map() }

type SignalWindow = {
  /** The entries the reads ran against; the scene pass diffs these, not the live ones. */
  entries: readonly SignalEntry[]
  deltas: SignalDelta[]
  replyEdits: ReplyEdit[]
  boundaries: TurnBoundaries | null
}
const EMPTY_WINDOW: SignalWindow = { entries: [], deltas: [], replyEdits: [], boundaries: null }

export function useRowSignals(branchId: string): RowSignalsSnapshot {
  // Raw maps are stable; a fresh derived array here would break useSyncExternalStore's contract.
  const entryRows = entriesStore.useEntries((m) => m)
  const entries = useMemo(
    () =>
      [...entryRows.values()]
        .filter((e) => e.branchId === branchId)
        .sort((a, b) => a.position - b.position),
    [entryRows, branchId],
  )
  const entityRows = entitiesStore.useEntities((m) => m)
  const entities = useMemo(
    () => [...entityRows.values()].filter((e) => e.branchId === branchId),
    [entityRows, branchId],
  )
  const [latestReplyId = null, fadingReplyId = null] = latestReplyIds(entries)
  // settleCount marks the moment a run's writes are final; shared across every mounted instance.
  const settleCount = generationStore.useGeneration((s) => s.settleCount)

  const { data, error } = useQuery({
    queryKey: ['row-signals', branchId, latestReplyId, fadingReplyId, settleCount],
    enabled: branchId !== '' && latestReplyId != null,
    // Local DB read, not a flaky network call — a failure is worth surfacing, not retried.
    retry: false,
    queryFn: async (): Promise<SignalWindow> => {
      // Manual scene edits don't refetch; live entries may carry edits this window can't explain.
      const snapshot = entries
      const boundaries = await readTurnBoundaries(db, branchId, snapshot)
      if (boundaries == null) return EMPTY_WINDOW
      const deltas = await readSignalDeltas(db, branchId, boundaries.fading ?? boundaries.fresh)
      const replyEdits = await readReplyEdits(db, branchId, latestReplyIds(snapshot))
      return { entries: snapshot, deltas, replyEdits, boundaries }
    },
  })

  // data is undefined during a pending refetch and after an error; keep the last
  // successful window, tagged by branch so a fork never shows another branch's tints.
  const [lastGood, setLastGood] = useState<{ branchId: string; window: SignalWindow } | null>(null)
  let good = lastGood
  if (latestReplyId == null || good?.branchId !== branchId) good = null
  // Compare against the wrapped window (not a fresh wrapper) to avoid re-rendering every render.
  if (latestReplyId != null && data != null && data !== good?.window) {
    good = { branchId, window: data }
  }
  if (good !== lastGood) setLastGood(good)

  const signalWindow = good?.window ?? EMPTY_WINDOW

  useEffect(() => {
    if (error == null) return
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('app.row_signals_read_failed', { branchId, error: message })
  }, [error, branchId])

  const categoryOf = useMemo(() => {
    const kinds = new Map(entities.map((e) => [e.id, e.kind]))
    return (id: string): EntityKind | null => kinds.get(id) ?? null
  }, [entities])

  const recentlyClassified = useMemo(
    () =>
      signalWindow.boundaries == null
        ? EMPTY_SIGNALS
        : selectRecentlyClassified({
            deltas: signalWindow.deltas,
            replyEdits: signalWindow.replyEdits,
            entries: signalWindow.entries,
            boundaries: signalWindow.boundaries,
            categoryOf,
          }),
    [signalWindow, categoryOf],
  )
  const inScene = useMemo(() => selectInScene(entries, entities), [entries, entities])

  return useMemo(() => ({ recentlyClassified, inScene }), [recentlyClassified, inScene])
}
