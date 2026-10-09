import { useContext } from 'react'
import { View, type ViewStyle } from 'react-native'

import { ScrollComponentContext } from '@/components/ui/scroll-component'
import type { EntryIndex } from '@/lib/entry-refs'

import { PeekBody } from './peek-body'
import { PeekFoot } from './peek-foot'
import { PeekHead, type PeekChrome, type PeekHeadIdentity } from './peek-head'
import {
  characterLeadOf,
  peekNameOf,
  type PeekLeadControl,
  type PeekModel,
  type PeekRegionPress,
} from './peek-model'
import type { PeekEntityContext } from './use-peek-view'

export type PeekContentProps = {
  model: PeekModel
  entityContext: PeekEntityContext
  entryIndex: EntryIndex | null
  lead: PeekLeadControl
  chrome: PeekChrome
  onOpenInPanel: () => void
  onRegionPress: PeekRegionPress
}

// On native the phone Sheet's scroll view is gorhom's, which NativeWind never styles.
const FILL = { flex: 1 } satisfies ViewStyle

function identityOf(model: PeekModel, lead: PeekLeadControl): PeekHeadIdentity {
  switch (model.kind) {
    case 'entity': {
      const { row } = model
      if (row.kind === 'character') {
        return { kind: 'character', lead: characterLeadOf(row, model.leadLabel, lead) }
      }
      return { kind: row.kind }
    }
    case 'lore':
      return { kind: 'lore' }
    case 'thread':
      return { kind: 'thread', icon: model.row.icon }
    case 'happening':
      return { kind: 'happening', icon: model.row.icon }
  }
}

/** The peek both hosts render: head, the kind's body, then the foot link. */
export function PeekContent({
  model,
  entityContext,
  entryIndex,
  lead,
  chrome,
  onOpenInPanel,
  onRegionPress,
}: PeekContentProps) {
  // A plain context read with a ScrollView default: no provider needed above the right Sheet's
  // Portal; the phone Sheet provides gorhom's inside its own tree.
  const Scroll = useContext(ScrollComponentContext)
  const identity = identityOf(model, lead)
  return (
    <View testID="peek-content" className="flex-1">
      <PeekHead
        {...identity}
        name={peekNameOf(model)}
        recentlyClassified={model.recentlyClassified != null}
        chrome={chrome}
      />
      <Scroll style={FILL}>
        <View className="p-4">
          <PeekBody
            model={model}
            entityContext={entityContext}
            entryIndex={entryIndex}
            onRegionPress={onRegionPress}
          />
        </View>
      </Scroll>
      <PeekFoot category={identity.kind} onOpenInPanel={onOpenInPanel} />
    </View>
  )
}
