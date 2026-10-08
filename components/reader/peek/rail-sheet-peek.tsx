import { useEffect } from 'react'

import { railRowHref } from '@/components/reader/rail/rail-modules'
import type { RailData } from '@/components/reader/rail/use-rail-data'
import { worldHref } from '@/components/world/world-selection'
import type { RailPeek } from '@/lib/reader-rail'

import { PeekContent } from './peek-content'
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

/** The phone rail Sheet's peek level (M4 C10's slot), rendered through `RailSheet`'s `renderPeek`. */
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
      lead={{
        leadId: data.entityListSignals.leadId,
        blocked,
        blockedReason,
        pending,
        onSetLead: setLead,
      }}
      chrome={{ kind: 'back', onBack }}
      onOpenInPanel={() => onOpenInPanel(railRowHref(data.branchId, peek.category, peek.id))}
      onRegionPress={(tab) => {
        if (model.kind !== 'entity') return
        onOpenInPanel(worldHref(data.branchId, { category: model.row.kind, id: model.row.id, tab }))
      }}
    />
  )
}
