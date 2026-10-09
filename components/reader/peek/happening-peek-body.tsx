import { CircleDot } from 'lucide-react-native'
import { View } from 'react-native'

import { whenMarker } from '@/components/plot/when-marker'
import { Icon } from '@/components/ui/icon'
import { Tag, type TagTone } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import type { Happening } from '@/lib/db'
import { t } from '@/lib/i18n'

import type { PeekEntryIndex } from './use-peek-view'

// An unread anchor can't be told from a dangling one, so `temporal` shows first; a failed read
// says so rather than leave the anchor unplaced without a word.
function markerOf(
  row: Happening,
  entryIndex: PeekEntryIndex,
): { tone: TagTone; label: string } | null {
  if (entryIndex.state === 'ready') return whenMarker(row, entryIndex.index)
  const temporal = row.temporal?.trim()
  if (temporal) return { tone: 'soft', label: temporal }
  if (entryIndex.state === 'failed' && row.occurredAtEntryId != null) {
    return { tone: 'warning', label: t('plot:entryIndexFailed') }
  }
  return null
}

/** reader-composer.md → State-field composition — thread and happening peek: read-only. */
export function HappeningPeekBody({
  happening,
  involved,
  aware,
  entryIndex,
}: {
  happening: Happening
  involved: number
  aware: number
  entryIndex: PeekEntryIndex
}) {
  const marker = markerOf(happening, entryIndex)
  // plot.md → Common-knowledge interaction: such a happening skips awareness rows.
  const commonKnowledge = happening.commonKnowledge === 1
  const category = happening.category?.trim()
  const description = happening.description?.trim()
  const counts = [
    t('reader:peek.involved', { count: involved }),
    commonKnowledge ? t('reader:peek.commonKnowledge') : t('reader:peek.aware', { count: aware }),
  ].join(' · ')
  return (
    <View testID="happening-peek-body" className="gap-3">
      {marker != null || commonKnowledge || category ? (
        <View className="flex-row flex-wrap items-center gap-1.5">
          {marker != null ? (
            // `temporal` is unbounded model text: one line, ellipsized.
            <Tag tone={marker.tone} className="max-w-full">
              <Text numberOfLines={1} className="shrink">
                {marker.label}
              </Text>
            </Tag>
          ) : null}
          {commonKnowledge ? (
            <View accessibilityRole="image" aria-label={t('plot:commonKnowledgeMarker')}>
              <Icon as={CircleDot} size="sm" />
            </View>
          ) : null}
          {category ? <Tag tone="soft">{category}</Tag> : null}
        </View>
      ) : null}
      {description ? <Text size="sm">{description}</Text> : null}
      <Text size="xs" variant="muted" testID="happening-peek-counts">
        {counts}
      </Text>
    </View>
  )
}
