import { useMemo, useState } from 'react'
import { View } from 'react-native'

import { RailSheetPeek } from '@/components/reader/peek/rail-sheet-peek'
import { readerRailStore } from '@/lib/stores'

import { BrowseChip } from './browse-chip'
import { RailSheet } from './rail-sheet'
import { railChipTintOf, type RailData } from './use-rail-data'

export type ReaderBrowseChipProps = {
  data: RailData
  storyId: string | null
  blocked: boolean
  blockedReason: string | undefined
  /** Routes after the Sheet has started closing. */
  onNavigate: (href: string) => void
}

export function ReaderBrowseChip({
  data,
  storyId,
  blocked,
  blockedReason,
  onNavigate,
}: ReaderBrowseChipProps) {
  const [open, setOpen] = useState(false)
  const view = readerRailStore.useView()
  const tint = useMemo(() => railChipTintOf(data), [data])
  const openInPanel = (href: string) => {
    // The peek stays pressable while the Sheet animates out; a second press must not re-navigate.
    if (!open) return
    // layout.md → Stacking: dismiss the Sheet, then navigate.
    setOpen(false)
    onNavigate(href)
  }
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
        renderPeek={(peek, back) => (
          <RailSheetPeek
            peek={peek}
            data={data}
            storyId={storyId}
            blocked={blocked}
            blockedReason={blockedReason}
            onBack={back}
            onOpenInPanel={openInPanel}
          />
        )}
      />
    </View>
  )
}
