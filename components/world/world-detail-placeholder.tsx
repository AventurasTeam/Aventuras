import { View } from 'react-native'

import { DetailPane } from '@/components/shells/detail-pane'
import { EmptyState } from '@/components/ui/empty-state'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import type { Lore } from '@/lib/db'
import { t } from '@/lib/i18n'
import type { RecentlyClassified } from '@/lib/row-signals'

export type WorldPlaceholderSelection = { type: 'lore'; row: Lore }

type WorldDetailPlaceholderProps = {
  selection: WorldPlaceholderSelection | null
  /** Mirrors the row tint in the head (patterns/entity.md → Detail-pane mirroring). */
  recentlyClassified?: RecentlyClassified
}

export function WorldDetailPlaceholder({
  selection,
  recentlyClassified,
}: WorldDetailPlaceholderProps) {
  if (selection == null) {
    return (
      <View className="flex-1 items-center justify-center bg-bg-base">
        <EmptyState title={t('world:detail.selectRow')} subtext={t('world:detail.selectRowBody')} />
      </View>
    )
  }
  return (
    <DetailPane
      nameSlot={
        <Text testID="world-detail-name" size="lg" className="font-semibold" numberOfLines={1}>
          {selection.row.title}
        </Text>
      }
      badges={
        recentlyClassified != null ? (
          <Tag tone="recently-classified">{t('world:detail.recentlyClassified')}</Tag>
        ) : undefined
      }
      overflowMenu={null}
      tabs={null}
    >
      <EmptyState
        title={t('world:detail.lorePlaceholder')}
        subtext={t('world:detail.placeholderBody')}
      />
    </DetailPane>
  )
}

export type { WorldDetailPlaceholderProps }
