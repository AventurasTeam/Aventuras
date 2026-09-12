import { BookOpen } from 'lucide-react-native'
import { View } from 'react-native'

import { EntityKindIcon } from '@/components/entity/entity-kind-icon'
import { DetailPane } from '@/components/shells/detail-pane'
import { EmptyState } from '@/components/ui/empty-state'
import { Icon } from '@/components/ui/icon'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import type { Entity, Lore } from '@/lib/db'
import { t } from '@/lib/i18n'
import type { RecentlyClassified } from '@/lib/row-signals'

import { worldKindName } from './world-selection'

/** An entity's kind lives only on its row, so no copy of it can disagree. */
export type WorldDetailSelection = { type: 'entity'; row: Entity } | { type: 'lore'; row: Lore }

type WorldDetailPlaceholderProps = {
  selection: WorldDetailSelection | null
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
  const badge =
    recentlyClassified != null ? (
      <Tag tone="recently-classified">{t('world:detail.recentlyClassified')}</Tag>
    ) : undefined
  if (selection.type === 'lore') {
    return (
      <DetailPane
        kindIcon={<Icon as={BookOpen} size="sm" />}
        kindName={worldKindName('lore')}
        nameSlot={
          <Text testID="world-detail-name" size="lg" className="font-semibold" numberOfLines={1}>
            {selection.row.title}
          </Text>
        }
        badges={badge}
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
  return (
    <DetailPane
      kindIcon={<EntityKindIcon kind={selection.row.kind} className="h-4 w-4" />}
      kindName={worldKindName(selection.row.kind)}
      nameSlot={
        <Text testID="world-detail-name" size="lg" className="font-semibold" numberOfLines={1}>
          {selection.row.name}
        </Text>
      }
      badges={badge}
      overflowMenu={null}
      tabs={null}
    >
      <EmptyState
        title={t('world:detail.entityPlaceholder')}
        subtext={t('world:detail.placeholderBody')}
      />
    </DetailPane>
  )
}

export type { WorldDetailPlaceholderProps }
