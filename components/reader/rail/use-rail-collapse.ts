import { useCallback, useEffect } from 'react'
import { useWindowDimensions } from 'react-native'

import { setReaderRailCollapsed } from '@/lib/actions'
import { db, runInTransaction } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { appSettingsStore, readerRailStore, type AppSettingsSnapshot } from '@/lib/stores'

const ctx = { db, runInTransaction }

const selectStoredCollapsed = (s: AppSettingsSnapshot): boolean => s.appearance.readerRailCollapsed

/** The rail's displayed collapse, read-only; `useRailCollapse` owns the `persisted` effect. */
export function useRailShowsCollapsed(): boolean {
  const stored = appSettingsStore.useAppSettings(selectStoredCollapsed)
  const { width } = useWindowDimensions()
  return readerRailStore.useCollapsed(stored, width)
}

/** The rail's displayed collapse and its toggle: the display moves first, the write follows. */
export function useRailCollapse(): {
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
} {
  const stored = appSettingsStore.useAppSettings(selectStoredCollapsed)
  const settledPending = readerRailStore.useSettledPending()
  const collapsed = useRailShowsCollapsed()

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
