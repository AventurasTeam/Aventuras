import { useMemo } from 'react'

import { resolveHeadTurn } from '@/lib/head-turn'
import { entriesStore } from '@/lib/stores'
import { storyLocationIdOf } from '@/lib/world'

/** The tail scene's location, from the live entries store; the place rules' "the story". */
export function useStoryLocationId(branchId: string): string | null {
  const entryRows = entriesStore.useEntries((m) => m)
  return useMemo(
    () =>
      storyLocationIdOf(
        resolveHeadTurn(
          [...entryRows.values()]
            .filter((e) => e.branchId === branchId)
            .sort((a, b) => a.position - b.position),
        ),
      ),
    [entryRows, branchId],
  )
}
