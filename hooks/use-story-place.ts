import { useMemo } from 'react'

import { resolveHeadTurn } from '@/lib/head-turn'
import { NARRATIVE_KINDS } from '@/lib/piggyback'
import { entriesStore } from '@/lib/stores'
import { storyPlaceOf, type StoryPlace } from '@/lib/world'

/** Where the story is (`storyPlaceOf`), from the live entries store. */
export function useStoryPlace(branchId: string): StoryPlace {
  const entryRows = entriesStore.useEntries((m) => m)
  return useMemo(() => {
    const entries = [...entryRows.values()]
      .filter((e) => e.branchId === branchId)
      .sort((a, b) => a.position - b.position)
    return storyPlaceOf({
      tail: resolveHeadTurn(entries)?.tail,
      sceneSource: entries.findLast((e) => NARRATIVE_KINDS.has(e.kind)),
    })
  }, [entryRows, branchId])
}
