import { CircleDot } from 'lucide-react-native'
import { View } from 'react-native'

import { ListRow } from '@/components/compounds/list-row'
import type { RowRendererProps } from '@/components/list/list-module'
import { Icon } from '@/components/ui/icon'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import type { Happening } from '@/lib/db'
import type { PlotListSignals } from '@/lib/list-modules'

import { PlotIcon } from './plot-icon'
import { whenMarker } from './when-marker'

// plot.md → Happenings side → Row composition.
export function HappeningRow({
  row,
  selected,
  onPress,
  signals,
  listSignals,
  density = 'default',
  focusRef,
}: RowRendererProps<Happening, PlotListSignals>) {
  const marker = whenMarker(row, listSignals.entries)
  const category = row.category?.trim()
  return (
    <ListRow
      ref={focusRef}
      label={row.title}
      description={density === 'default' && category ? category : undefined}
      leading={<PlotIcon kind="happening" icon={row.icon} />}
      // `temporal` is unbounded model text: cap and ellipsize so it can't squash the title.
      meta={
        marker != null ? (
          <Tag tone={marker.tone}>
            <Text numberOfLines={1} className="max-w-36">
              {marker.label}
            </Text>
          </Tag>
        ) : undefined
      }
      // The slot stays when CK is off so every row keeps one layout (plot.md → Row indicators).
      trailing={
        <View className="w-5 items-center">
          {row.commonKnowledge === 1 ? <Icon as={CircleDot} size="sm" /> : null}
        </View>
      }
      recentlyClassified={signals.recentlyClassified}
      selected={selected}
      onPress={onPress}
    />
  )
}
