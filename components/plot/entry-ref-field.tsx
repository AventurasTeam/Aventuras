import { View } from 'react-native'

import { EntryRefText } from '@/components/compounds/entry-ref-picker'
import { Text } from '@/components/ui/text'
import type { EntryIndex } from '@/lib/entry-refs'
import { t } from '@/lib/i18n'

type EntryRefFieldProps = {
  id: string | null
  /** A ready index: an id it lacks renders as dangling. */
  entryIndex: EntryIndex
}

/** A read-only `entry #n` for the classifier-owned refs (plot.md → Threads side). */
export function EntryRefField({ id, entryIndex }: EntryRefFieldProps) {
  return (
    // Control height, so the value lines up with the label like the editable rows' controls.
    <View className="min-h-control-md justify-center">
      {id == null ? (
        <Text size="sm" variant="muted">
          {t('plot:fields.notRecorded')}
        </Text>
      ) : (
        <EntryRefText entry={entryIndex.get(id) ?? null} />
      )}
    </View>
  )
}
