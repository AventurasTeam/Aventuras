import { EntityOverview } from '@/components/world/overview/entity-overview'
import type { EntryIndex } from '@/lib/entry-refs'

import { HappeningPeekBody } from './happening-peek-body'
import { LorePeekBody } from './lore-peek-body'
import type { PeekModel, PeekRegionPress } from './peek-model'
import { ThreadPeekBody } from './thread-peek-body'
import type { PeekEntityContext } from './use-peek-view'

/** reader-composer.md → State-field composition. */
export const PEEK_ENTITY_BODY = EntityOverview

export type PeekBodyProps = {
  model: PeekModel
  entityContext: PeekEntityContext
  entryIndex: EntryIndex | null
  onRegionPress: PeekRegionPress
}

export function PeekBody({ model, entityContext, entryIndex, onRegionPress }: PeekBodyProps) {
  switch (model.kind) {
    case 'entity': {
      const { row } = model
      return (
        <PEEK_ENTITY_BODY
          variant="peek"
          entity={row}
          entities={entityContext.entities}
          worldTime={entityContext.worldTime}
          calendar={entityContext.calendar}
          onRegionPress={(tab) => onRegionPress(row, tab)}
        />
      )
    }
    case 'lore':
      return <LorePeekBody lore={model.row} />
    case 'thread':
      return <ThreadPeekBody thread={model.row} />
    case 'happening':
      return (
        <HappeningPeekBody
          happening={model.row}
          involved={model.involved}
          aware={model.aware}
          entryIndex={entryIndex}
        />
      )
  }
}
