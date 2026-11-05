import { useCallback, useRef } from 'react'

import { ENTRIES_WINDOW_SIZE, readEntriesBefore } from '@/lib/actions'
import type { DbCtx } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { entriesStore } from '@/lib/stores'

import { oldestLoadedPosition } from './use-entry-jump'

/** Never rejects: on native the document awaits this across the bridge, where a rejection dies unlogged. */
async function loadAboveWindow(
  branchId: string,
  db: DbCtx['db'],
  onBoundary: (hasOlder: boolean) => void,
): Promise<void> {
  try {
    let oldest = oldestLoadedPosition(branchId)
    while (oldest !== null) {
      const older = await readEntriesBefore(branchId, oldest, db)
      const oldestNow = oldestLoadedPosition(branchId)
      if (oldestNow === oldest) {
        entriesStore.insertMany(branchId, older)
        onBoundary(older.length >= ENTRIES_WINDOW_SIZE)
        return
      }
      oldest = oldestNow
    }
  } catch (error) {
    logger.warn('reader.load_older_failed', {
      branchId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Loads the page above the window, one load at a time per branch. A read the window moved under (a
 * reload shrank it, a jump grew it, the branch left) is read again from the new top, or dropped, so
 * the window stays contiguous and `onBoundary` reports the top the window actually has.
 */
export function useLoadOlderEntries(
  branchId: string,
  db: DbCtx['db'],
  onBoundary: (hasOlder: boolean) => void,
): () => Promise<void> {
  // The reader route keeps this hook across a branch switch, while the branch left may be reading.
  const loadingRef = useRef(new Set<string>())
  return useCallback(async () => {
    if (loadingRef.current.has(branchId)) return
    loadingRef.current.add(branchId)
    await loadAboveWindow(branchId, db, onBoundary)
    loadingRef.current.delete(branchId)
  }, [branchId, db, onBoundary])
}
