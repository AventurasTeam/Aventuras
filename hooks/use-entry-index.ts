import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { db } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { indexEntryRefs, readEntryIndex, type EntryIndex, type EntryRef } from '@/lib/entry-refs'
import { entriesStore, generationStore } from '@/lib/stores'

export type EntryIndexSnapshot = {
  /** Newest first — the picker's list order. */
  entries: readonly EntryRef[]
  index: EntryIndex
  ready: boolean
}

const EMPTY_ENTRIES: readonly EntryRef[] = []
const EMPTY_INDEX: EntryIndex = new Map()
const EMPTY: EntryIndexSnapshot = { entries: EMPTY_ENTRIES, index: EMPTY_INDEX, ready: false }

/**
 * The branch's entries for `entry #n` labels, chapter buckets and the entry-ref picker.
 * Refetches when a run settles (a turn, a reversal) or the tail moves: positions get
 * reused after a rollback, so a cached label could re-point to a different entry.
 */
export function useEntryIndex(branchId: string): EntryIndexSnapshot {
  const settleCount = generationStore.useGeneration((s) => s.settleCount)
  const tailId = entriesStore.useEntries((m) => {
    let last: string | null = null
    let position = -1
    for (const e of m.values()) {
      if (e.branchId === branchId && e.position > position) {
        position = e.position
        last = e.id
      }
    }
    return last
  })
  const { data } = useQuery({
    queryKey: ['entry-index', branchId, settleCount, tailId],
    enabled: branchId !== '',
    // Local DB read, not a flaky network call — a failure is worth surfacing, not retried.
    retry: false,
    queryFn: async () => {
      try {
        return await readEntryIndex(branchId, db)
      } catch (err) {
        logger.error('app.entry_index_read_failed', {
          branchId,
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    },
  })
  return useMemo(
    () => (data == null ? EMPTY : { entries: data, index: indexEntryRefs(data), ready: true }),
    [data],
  )
}
