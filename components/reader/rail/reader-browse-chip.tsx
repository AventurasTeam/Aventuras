import { useMemo, useState } from 'react'
import { View } from 'react-native'

import type { RailCategory } from '@/lib/reader-rail'
import { readerRailStore } from '@/lib/stores'

import { BrowseChip } from './browse-chip'
import { RailSheet } from './rail-sheet'
import { railChipTintOf, type RailData } from './use-rail-data'

export type ReaderBrowseChipProps = {
  data: RailData
  onRowPress: (category: RailCategory, id: string) => void
}

export function ReaderBrowseChip({ data, onRowPress }: ReaderBrowseChipProps) {
  const [open, setOpen] = useState(false)
  const view = readerRailStore.useView()
  const tint = useMemo(() => railChipTintOf(data), [data])
  return (
    // One element: on native the Sheet's dialog root is a View that would join the chip row's gap.
    <View className="flex-row items-center">
      <BrowseChip tint={tint} expanded={open} onPress={() => setOpen(true)} />
      <RailSheet
        open={open}
        onOpenChange={setOpen}
        data={data}
        view={view}
        onViewChange={(next) => readerRailStore.setView(next)}
        onCategoryChange={(category) => readerRailStore.setCategory(category)}
        onRowPress={(category, id) => {
          // Rows stay pressable while the Sheet animates out; a second tap must not navigate again.
          if (!open) return
          // layout.md → Stacking: dismiss the Sheet, then navigate.
          setOpen(false)
          onRowPress(category, id)
        }}
      />
    </View>
  )
}
