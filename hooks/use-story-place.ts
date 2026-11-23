import { useMemo, useState } from 'react'

import { resolveHeadTurn } from '@/lib/head-turn'
import { NARRATIVE_KINDS } from '@/lib/piggyback'
import { entriesStore } from '@/lib/stores'
import { storyPlaceOf, type StoryPlace } from '@/lib/world'

/**
 * Where the story is (`storyPlaceOf`), from the live entries store. Keeps its identity until the
 * tail's or the scene's place moves, so a consumer's memo doesn't rebuild on every entries patch.
 */
export function useStoryPlace(branchId: string): StoryPlace {
  const entryRows = entriesStore.useEntries(branchId, (m) => m)
  const place = useMemo(() => {
    const entries = [...entryRows.values()].sort((a, b) => a.position - b.position)
    return storyPlaceOf({
      tail: resolveHeadTurn(entries)?.tail,
      sceneSource: entries.findLast((e) => NARRATIVE_KINDS.has(e.kind)),
    })
  }, [entryRows])
  const [stable, setStable] = useState(place)
  if (place.tail !== stable.tail || place.scene !== stable.scene) setStable(place)
  return stable
}
