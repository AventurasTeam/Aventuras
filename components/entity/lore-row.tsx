import { ListRow } from '@/components/compounds/list-row'
import { Tag } from '@/components/ui/tag'
import type { Lore } from '@/lib/db'

import { EntityKindIcon } from './entity-kind-icon'
import type { RowRendererProps } from './list-module'

const EXCERPT_CHARS = 120

// Array.from splits code points, not UTF-16 units — slicing could sever an emoji surrogate pair.
function excerpt(body: string | null): string | undefined {
  if (body == null) return undefined
  const collapsed = body.replace(/\s+/g, ' ').trim()
  if (collapsed === '') return undefined
  const chars = Array.from(collapsed)
  if (chars.length <= EXCERPT_CHARS) return collapsed
  const cut = chars.slice(0, EXCERPT_CHARS).join('')
  if (chars[EXCERPT_CHARS] === ' ') return `${cut}…`
  const lastSpace = cut.lastIndexOf(' ')
  return `${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}…`
}

export function LoreRow({
  row,
  selected,
  onPress,
  signals,
  density = 'default',
}: RowRendererProps<Lore>) {
  return (
    <ListRow
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
