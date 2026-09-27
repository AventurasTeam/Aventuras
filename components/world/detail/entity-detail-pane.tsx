import type { EntityKind } from '@/lib/db'

import { CharacterDetailPane } from './character-detail-pane'
import type { EntityPaneProps } from './entity-pane-props'
import { FactionDetailPane } from './faction-detail-pane'
import { ItemDetailPane } from './item-detail-pane'
import { LocationDetailPane } from './location-detail-pane'

/** patterns/entity.md → Hand-written per-kind components: one pane per kind. */
export function EntityDetailPane({ kind, ...props }: EntityPaneProps & { kind: EntityKind }) {
  switch (kind) {
    case 'character':
      return <CharacterDetailPane {...props} />
    case 'location':
      return <LocationDetailPane {...props} />
    case 'item':
      return <ItemDetailPane {...props} />
    case 'faction':
      return <FactionDetailPane {...props} />
  }
}
