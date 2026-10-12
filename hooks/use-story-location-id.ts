import { useMemo } from 'react'

import { entriesStore } from '@/lib/stores'
import { storyLocationIdOf } from '@/lib/world'

/** The story's location (`storyLocationIdOf`), from the live entries store. */
export function useStoryLocationId(branchId: string): string | null {
  const entryRows = entriesStore.useEntries((m) => m)
  return useMemo(
    () =>
      storyLocationIdOf(
        [...entryRows.values()]
          .filter((e) => e.branchId === branchId)
          .sort((a, b) => a.position - b.position),
      ),
    [entryRows, branchId],
  )
}
