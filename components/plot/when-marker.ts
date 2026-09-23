import type { TagTone } from '@/components/ui/tag'
import type { Happening } from '@/lib/db'
import { formatEntryRef, type EntryIndex } from '@/lib/entry-refs'
import { t } from '@/lib/i18n'

/** The when-marker: an `entry #n` chip, the dangling state, or the free-text `temporal`. */
export function whenMarker(
  row: Happening,
  entries: EntryIndex,
): { tone: TagTone; label: string } | null {
  // Model-authored free text: whitespace-only reads as unset, not a blank chip.
  const temporal = row.temporal?.trim()
  if (temporal) return { tone: 'soft', label: temporal }
  if (row.occurredAtEntryId == null) return null
  const entry = entries.get(row.occurredAtEntryId)
  if (entry == null) return { tone: 'warning', label: t('entryRefDangling') }
  return { tone: 'soft', label: formatEntryRef(entry.position) }
}
