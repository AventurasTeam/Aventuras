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

/** A row press does exactly one thing: routes out, or opens the peek in place. */
type RailSheetRowPress =
  | {
      /** Routes the row out to its panel. */
      onRowPress: (category: RailCategory, id: string) => void
      renderPeek?: never
    }
  | {
      /**
       * Peek slot: a row press swaps the list for the peek at the tall detent. Called inline at the
       * peek level only, so it returns an element and must not call hooks.
       */
      renderPeek: (peek: RailPeek, back: () => void) => ReactNode
      onRowPress?: never
    }

export type RailSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: RailData
  view: RailView
  onViewChange: (view: RailView) => void
  onCategoryChange: (category: RailCategory) => void
} & RailSheetRowPress

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
