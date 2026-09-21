import { CircleDot } from 'lucide-react-native'
import { View } from 'react-native'

import { ListRow } from '@/components/compounds/list-row'
import type { RowRendererProps } from '@/components/list/list-module'
import { Icon } from '@/components/ui/icon'
import { Tag, type TagTone } from '@/components/ui/tag'
import type { Happening } from '@/lib/db'
import { formatEntryRef, type EntryIndex } from '@/lib/entry-refs'
import { t } from '@/lib/i18n'
import type { PlotListSignals } from '@/lib/list-modules'

import { PlotIcon } from './plot-icon'

/** The when-marker: an `entry #n` chip, the dangling state, or the free-text `temporal`. */
export function whenMarker(
  row: Happening,
  entries: EntryIndex,
): { tone: TagTone; label: string } | null {
  if (row.temporal != null) return { tone: 'soft', label: row.temporal }
  if (row.occurredAtEntryId == null) return null
  const entry = entries.get(row.occurredAtEntryId)
  if (entry == null) return { tone: 'warning', label: t('entryRefDangling') }
  return { tone: 'soft', label: formatEntryRef(entry.position) }
}

// plot.md → Happenings side → Row composition: glyph, title, when-marker, category, ⊙ slot.
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
      meta={marker != null ? <Tag tone={marker.tone}>{marker.label}</Tag> : undefined}
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
