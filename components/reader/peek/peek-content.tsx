import { ArrowLeft, X } from 'lucide-react-native'
import { useContext } from 'react'
import { View, type ViewStyle } from 'react-native'

import { IconAction } from '@/components/ui/icon-action'
import { ScrollComponentContext } from '@/components/ui/scroll-component'
import type { RegionPress } from '@/components/world/overview/overview-parts'
import type { EntryIndex } from '@/lib/entry-refs'
import { t } from '@/lib/i18n'
import type { RailCategory } from '@/lib/reader-rail'

import { PeekBody } from './peek-body'
import { PeekFoot } from './peek-foot'
import { PeekHead } from './peek-head'
import { peekLeadOf, type PeekLeadControl, type PeekModel } from './peek-model'
import type { PeekEntityContext } from './use-peek-view'

/** Desktop / tablet close with `×`; phone goes back to the rail Sheet's list with `←`. */
export type PeekChrome =
  | { kind: 'close'; onClose: () => void }
  | { kind: 'back'; onBack: () => void }

export type PeekContentProps = {
  model: PeekModel
  entityContext: PeekEntityContext
  entryIndex: EntryIndex | null
  lead: PeekLeadControl
  chrome: PeekChrome
  onOpenInPanel: () => void
  onRegionPress: RegionPress
}

// In the phone Sheet the scroll view is gorhom's Animated one, which NativeWind never styles.
const FILL = { flex: 1 } satisfies ViewStyle

type PeekIdentity = { category: RailCategory; name: string; icon?: string | null }

function identityOf(model: PeekModel): PeekIdentity {
  switch (model.kind) {
    case 'entity':
      return { category: model.row.kind, name: model.row.name }
    case 'lore':
      return { category: 'lore', name: model.row.title }
    case 'thread':
      return { category: 'thread', name: model.row.title, icon: model.row.icon }
    case 'happening':
      return { category: 'happening', name: model.row.title, icon: model.row.icon }
  }
}

/** The peek both hosts render: head, the kind's body, then the C6 foot link. */
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
  const { category, name, icon } = identityOf(model)
  return (
    <View testID="peek-content" className="flex-1">
      <PeekHead
        kind={category}
        name={name}
        icon={icon}
        recentlyClassified={model.recentlyClassified != null}
        lead={peekLeadOf(model, lead)}
        leading={
          chrome.kind === 'back' ? (
            <IconAction icon={ArrowLeft} label={t('reader:peek.back')} onPress={chrome.onBack} />
          ) : undefined
        }
        trailing={
          chrome.kind === 'close' ? (
            <IconAction icon={X} label={t('reader:peek.close')} onPress={chrome.onClose} />
          ) : undefined
        }
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
      <PeekFoot category={category} onOpenInPanel={onOpenInPanel} />
    </View>
  )
}
