import { useCallback } from 'react'

import type { RailCategory, RailPeek } from '@/lib/reader-rail'
import { appSettingsStore, readerRailStore } from '@/lib/stores'

/** The rail's peek slot: the row a press opens, and its close. */
export function useRailPeek(): {
  peek: RailPeek | null
  /** A no-op while the rail shows collapsed (reduceRailDisplay). */
  openPeek: (category: RailCategory, id: string) => void
  closePeek: () => void
} {
  const peek = readerRailStore.usePeek()
  const openPeek = useCallback((category: RailCategory, id: string) => {
    readerRailStore.dispatchDisplay({
      type: 'openPeek',
      peek: { category, id },
      // Read at the press: the reducer judges the collapse as it stands now, not as last rendered.
      storedCollapsed: appSettingsStore.getAppSettings().appearance.readerRailCollapsed,
    })
  }, [])
  const closePeek = useCallback(() => readerRailStore.dispatchDisplay({ type: 'closePeek' }), [])
  return { peek, openPeek, closePeek }
}
