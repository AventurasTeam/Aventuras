import { ArrowLeft } from 'lucide-react-native'
import { useEffect, useState, type ReactNode } from 'react'
import { View } from 'react-native'

import { Heading } from '@/components/ui/heading'
import { IconAction } from '@/components/ui/icon-action'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { t } from '@/lib/i18n'
import {
  RAIL_SHEET_OPENED,
  reduceRailSheet,
  type RailCategory,
  type RailPeek,
  type RailSheetEvent,
  type RailSheetState,
  type RailView,
} from '@/lib/reader-rail'

import { RailImportFooter } from './rail-import-footer'
import { RailList } from './rail-list'
import { railCategoryLabel } from './rail-modules'
import { RailSheetCategories } from './rail-sheet-categories'
import type { RailData } from './use-rail-data'

export type RailSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: RailData
  view: RailView
  onViewChange: (view: RailView) => void
  onCategoryChange: (category: RailCategory) => void
  /** Used when no peek renderer is given (4.5a): the row's panel. */
  onRowPress: (category: RailCategory, id: string) => void
  /** C10's peek slot; 4.5b fills it. With it, a row press swaps to the peek at the tall detent. */
  renderPeek?: (peek: RailPeek, back: () => void) => ReactNode
}

export function RailSheet({
  open,
  onOpenChange,
  data,
  view,
  onViewChange,
  onCategoryChange,
  onRowPress,
  renderPeek,
}: RailSheetProps) {
  const [sheet, setSheet] = useState<RailSheetState>(RAIL_SHEET_OPENED)
  const send = (event: RailSheetEvent) => setSheet((current) => reduceRailSheet(current, event))

  // The Sheet presents a tick after `open` flips, so this lands before anything renders.
  useEffect(() => {
    if (open) setSheet(RAIL_SHEET_OPENED)
  }, [open])

  const handleRowPress = (category: RailCategory, id: string) => {
    if (renderPeek == null) {
      onRowPress(category, id)
      return
    }
    send({ type: 'openPeek', peek: { category, id } })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} ariaLabel={t('reader:rail.label')}>
      <SheetContent anchor="bottom" size={sheet.size} className="p-0">
        {sheet.content === 'categories' ? (
          <RailSheetCategories
            value={view.category}
            tints={data.categoryTint}
            onPick={(category) => {
              onCategoryChange(category)
              send({ type: 'pickCategory' })
            }}
          />
        ) : sheet.content === 'list' ? (
          <View className="flex-1">
            <RailList
              data={data}
              view={view}
              onViewChange={onViewChange}
              header={
                <View className="flex-row items-center gap-1">
                  <IconAction
                    icon={ArrowLeft}
                    label={t('reader:rail.backToCategories')}
                    onPress={() => send({ type: 'up' })}
                  />
                  <Heading level={3} numberOfLines={1} className="min-w-0 shrink">
                    {railCategoryLabel(view.category)}
                  </Heading>
                </View>
              }
              onRowPress={handleRowPress}
              surface="transparent"
            />
            <View className="px-3 pb-3">
              <RailImportFooter />
            </View>
          </View>
        ) : (
          (renderPeek?.(sheet.peek, () => send({ type: 'back' })) ?? null)
        )}
      </SheetContent>
    </Sheet>
  )
}
