import { ListRow } from '@/components/compounds/list-row'
import type { RowRendererProps } from '@/components/list/list-module'
import { Tag } from '@/components/ui/tag'
import type { Lore } from '@/lib/db'
import { excerpt } from '@/lib/text'

import { EntityKindIcon } from './entity-kind-icon'

export function LoreRow({
  row,
  selected,
  onPress,
  signals,
  density = 'default',
  focusRef,
}: RowRendererProps<Lore>) {
  return (
    <ListRow
      ref={focusRef}
      label={row.title}
      description={density === 'compact' ? undefined : excerpt(row.body)}
      leading={<EntityKindIcon kind="lore" />}
      trailing={row.category?.trim() ? <Tag tone="soft">{row.category}</Tag> : undefined}
      recentlyClassified={signals.recentlyClassified}
      selected={selected}
      onPress={onPress}
    />
  )
}
