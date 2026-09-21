import { ListRow } from '@/components/compounds/list-row'
import type { RowRendererProps } from '@/components/list/list-module'
import { Tag, type TagTone } from '@/components/ui/tag'
import type { Thread } from '@/lib/db'
import { t } from '@/lib/i18n'

import { PlotIcon } from './plot-icon'

// chips.md → Tag — tone vocabulary; the Tag primitive's JSDoc spells the same map.
export const THREAD_STATUS_TONE: Record<Thread['status'], TagTone> = {
  active: 'default',
  pending: 'warning',
  resolved: 'success',
  failed: 'danger',
}

// plot.md → Threads side → Row composition: glyph, title, status pill, category.
export function ThreadRow({
  row,
  selected,
  onPress,
  signals,
  density = 'default',
  focusRef,
}: RowRendererProps<Thread>) {
  const category = row.category?.trim()
  return (
    <ListRow
      ref={focusRef}
      label={row.title}
      leading={<PlotIcon kind="thread" icon={row.icon} />}
      meta={density === 'default' && category ? <Tag tone="soft">{category}</Tag> : undefined}
      trailing={<Tag tone={THREAD_STATUS_TONE[row.status]}>{t(`plot:status.${row.status}`)}</Tag>}
      recentlyClassified={signals.recentlyClassified}
      selected={selected}
      onPress={onPress}
    />
  )
}
