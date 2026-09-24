import { View } from 'react-native'

import { DetailPane } from '@/components/shells/detail-pane'
import { EmptyState } from '@/components/ui/empty-state'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import type { Entity, Lore } from '@/lib/db'
import { t } from '@/lib/i18n'
import type { RecentlyClassified } from '@/lib/row-signals'

/** An entity's kind lives only on its row, so no copy of it can disagree. */
export type WorldPlaceholderSelection =
  | { type: 'entity'; row: Entity }
  | { type: 'lore'; row: Lore }

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
  const head =
    selection.type === 'lore'
      ? {
          name: selection.row.title,
          placeholder: t('world:detail.lorePlaceholder'),
        }
      : {
          name: selection.row.name,
          placeholder: t('world:detail.entityPlaceholder'),
        }
  return (
    <DetailPane
      nameSlot={
        <Text testID="world-detail-name" size="lg" className="font-semibold" numberOfLines={1}>
          {head.name}
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
      <EmptyState title={head.placeholder} subtext={t('world:detail.placeholderBody')} />
    </DetailPane>
  )
}

export type { WorldDetailPlaceholderProps }
