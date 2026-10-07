import { useCallback, useEffect, useState } from 'react'

import { setReaderRailCollapsed } from '@/lib/actions'
import { db, runInTransaction } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { isRailCollapsed } from '@/lib/reader-rail'
import { appSettingsStore, readerRailStore } from '@/lib/stores'

const ctx = { db, runInTransaction }

/** The rail's displayed collapse and its manual toggle: the display moves first, the write follows. */
export function useRailCollapse(): {
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
} {
  const stored = appSettingsStore.useAppSettings((s) => s.appearance.readerRailCollapsed)
  const pending = readerRailStore.useDisplay((display) => display.pendingCollapsed)
  const collapsed = readerRailStore.useDisplay((display) => isRailCollapsed(display, stored))
  const [writesInFlight, setWritesInFlight] = useState(0)

  // A resolved write doesn't prove the store re-hydrated (a failed read reports config-corrupt
  // rather than throwing), and an earlier write's re-hydrate can match a later toggle by chance:
  // only the store reaching the pending value with every write settled retires it.
  useEffect(() => {
    if (writesInFlight === 0 && pending !== null && stored === pending) {
      readerRailStore.dispatchDisplay({ type: 'persisted', collapsed: stored })
    }
  }, [writesInFlight, pending, stored])

  const setCollapsed = useCallback((next: boolean) => {
    readerRailStore.dispatchDisplay({ type: 'setCollapsed', collapsed: next })
    setWritesInFlight((count) => count + 1)
    void setReaderRailCollapsed(next, ctx)
      .catch((error: unknown) =>
        logger.warn('reader.rail_pref_write_failed', {
          collapsed: next,
          error: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => setWritesInFlight((count) => count - 1))
  }, [])

  return { collapsed, setCollapsed }
}
