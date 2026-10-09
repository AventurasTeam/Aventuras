import { useMemo } from 'react'

import { entriesStore } from '@/lib/stores'
import { branchWorldTime } from '@/lib/world'

/** The branch's current world time in seconds, from the live entries store. */
export function useBranchWorldTime(branchId: string): number {
  const entryRows = entriesStore.useEntries((m) => m)
  return useMemo(
    () =>
      branchWorldTime(
        [...entryRows.values()]
          .filter((e) => e.branchId === branchId)
          .sort((a, b) => a.position - b.position),
      ),
    [entryRows, branchId],
  )
}
