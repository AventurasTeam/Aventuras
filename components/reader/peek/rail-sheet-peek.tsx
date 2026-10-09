import { useEffect } from 'react'

import type { RailData } from '@/components/reader/rail/use-rail-data'
import type { RailPeek } from '@/lib/reader-rail'

import { PeekContent } from './peek-content'
import { peekFootHref, peekRegionHref } from './peek-model'
import { usePeekView } from './use-peek-view'
import { useSetLead } from './use-set-lead'

export type RailSheetPeekProps = {
  peek: RailPeek
  data: RailData
  storyId: string | null
  blocked: boolean
  blockedReason: string | undefined
  /** RailSheet's `back`: the list level. */
  onBack: () => void
  onOpenInPanel: (href: string) => void
}

/** The phone rail Sheet's peek level, rendered through `RailSheet`'s `renderPeek`. */
export function RailSheetPeek({
  peek,
  data,
  storyId,
  blocked,
  blockedReason,
  onBack,
  onOpenInPanel,
}: RailSheetPeekProps) {
  const { model, entityContext, entryIndex } = usePeekView(peek, data)
  const { pending, setLead } = useSetLead(storyId)
  const gone = model == null
  // A row deleted under the peek returns to the list rather than keep its id: an undo that
  // restored it must not reopen the peek (lessons-learned → No "harmless" id leaks).
  useEffect(() => {
    if (gone) onBack()
  }, [gone, onBack])
  if (model == null) return null
  return (
    <PeekContent
      model={model}
      entityContext={entityContext}
      entryIndex={entryIndex}
      lead={{ blocked, blockedReason, pending, onSetLead: setLead }}
      chrome={{ kind: 'back', onBack }}
      onOpenInPanel={() => onOpenInPanel(peekFootHref(data, peek))}
      onRegionPress={(tab) => {
        const href = peekRegionHref(data, model, tab)
        if (href != null) onOpenInPanel(href)
      }}
    />
  )
}
