import { useCallback, useEffect } from 'react'

import { setReaderRailCollapsed } from '@/lib/actions'
import { db, runInTransaction } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { appSettingsStore, readerRailStore } from '@/lib/stores'

const ctx = { db, runInTransaction }

/** The rail's displayed collapse and its toggle: the display moves first, the write follows. */
export function useRailCollapse(): {
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
} {
  const stored = appSettingsStore.useAppSettings((s) => s.appearance.readerRailCollapsed)
  const settledPending = readerRailStore.useSettledPending()
  const collapsed = readerRailStore.useCollapsed(stored)

  // Retire once the store matches with every write settled: a resolved write may not have
  // re-hydrated (failed reads report config-corrupt), and an earlier write can match by chance.
  useEffect(() => {
    if (settledPending !== null && stored === settledPending) {
      readerRailStore.dispatchDisplay({ type: 'persisted', collapsed: stored })
    }
  }, [settledPending, stored])

  const setCollapsed = useCallback((next: boolean) => {
    void readerRailStore
      .writeCollapsed(next, () => setReaderRailCollapsed(next, ctx))
      .catch((error: unknown) =>
        logger.error('reader.rail_pref_write_failed', {
          collapsed: next,
          error: error instanceof Error ? error.message : String(error),
        }),
      )
  }, [])

  return { collapsed, setCollapsed }
}
