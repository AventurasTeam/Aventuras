import { Star } from 'lucide-react-native'

import { CollisionListRow } from '@/components/compounds/collision-list-row'
import { ListRow, type ListRowProps } from '@/components/compounds/list-row'
import { Icon } from '@/components/ui/icon'
import { Tag, type TagTone } from '@/components/ui/tag'
import type { Entity } from '@/lib/db'
import { t } from '@/lib/i18n'

import { EntityKindIcon } from './entity-kind-icon'
import type { RowRendererProps } from './list-module'

// patterns/entity.md → Entity row indicators.
const STATUS_TONE: Record<Entity['status'], TagTone> = {
  active: 'default',
  staged: 'success',
  retired: 'warning',
}

// `density` is unused: entity rows have no description line to drop (unlike other rows).
export function EntityRow({ row, selected, onPress, signals }: RowRendererProps<Entity>) {
  const props: ListRowProps = {
    label: row.name,
    leading: <EntityKindIcon kind={row.kind} />,
    meta:
      signals.lead != null ? (
        <Tag
          tone="accent"
          leading={<Icon as={Star} aria-hidden size="sm" className="fill-accent-fg" />}
        >
          {t(`world:lead.${signals.lead}`)}
        </Tag>
      ) : undefined,
    trailing: <Tag tone={STATUS_TONE[row.status]}>{t(`world:status.${row.status}`)}</Tag>,
    inScene: signals.inScene,
    recentlyClassified: signals.recentlyClassified,
    selected,
    onPress,
  }
  if (signals.collision != null) {
    return <CollisionListRow row={props} collision={signals.collision} />
  }
  return <ListRow {...props} />
}
