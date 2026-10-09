import { CollisionListRow } from '@/components/compounds/collision-list-row'
import { ListRow, type ListRowProps } from '@/components/compounds/list-row'
import type { RowRendererProps } from '@/components/list/list-module'
import { Tag, type TagTone } from '@/components/ui/tag'
import type { Entity } from '@/lib/db'
import { t } from '@/lib/i18n'

import { EntityKindIcon } from './entity-kind-icon'
import { LeadTag } from './lead-tag'

// patterns/entity.md → Entity row indicators.
export const ENTITY_STATUS_TONE: Record<Entity['status'], TagTone> = {
  active: 'default',
  staged: 'success',
  retired: 'warning',
}

// `density` is unused: entity rows have no description line to drop (unlike other rows).
export function EntityRow({ row, selected, onPress, signals, focusRef }: RowRendererProps<Entity>) {
  const props: ListRowProps = {
    label: row.name,
    leading: <EntityKindIcon kind={row.kind} />,
    meta: signals.lead != null ? <LeadTag label={signals.lead} /> : undefined,
    trailing: <Tag tone={ENTITY_STATUS_TONE[row.status]}>{t(`world:status.${row.status}`)}</Tag>,
    inScene: signals.inScene,
    recentlyClassified: signals.recentlyClassified,
    selected,
    onPress,
    ref: focusRef,
  }
  if (signals.collision != null) {
    return <CollisionListRow row={props} collision={signals.collision} />
  }
  return <ListRow {...props} />
}
