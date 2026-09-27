import { ChevronRight } from 'lucide-react-native'
import { View } from 'react-native'

import { ListRow } from '@/components/compounds/list-row'
import { EmptyState } from '@/components/ui/empty-state'
import { Icon } from '@/components/ui/icon'
import { t } from '@/lib/i18n'

import type { EntityInvolvement } from '../world-route-data'

/** world.md → Assets, Involvements, History: read-only; a row opens its happening in Plot. */
export function InvolvementsTab({
  rows,
  onOpenHappening,
}: {
  rows: readonly EntityInvolvement[]
  onOpenHappening: (id: string) => void
}) {
  if (rows.length === 0)
    return (
      <EmptyState
        title={t('world:involvements.empty')}
        subtext={t('world:involvements.emptyBody')}
      />
    )
  return (
    <View className="gap-1" testID="involvements">
      {rows.map((row) => (
        <ListRow
          key={row.id}
          label={row.title}
          description={row.role?.trim() || t('world:involvements.noRole')}
          trailing={<Icon as={ChevronRight} aria-hidden size="sm" className="text-fg-muted" />}
          onPress={() => onOpenHappening(row.happeningId)}
        />
      ))}
    </View>
  )
}
