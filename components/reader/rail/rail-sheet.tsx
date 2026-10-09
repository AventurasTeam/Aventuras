import { ArrowLeft } from 'lucide-react-native'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Heading } from '@/components/ui/heading'
import { IconAction } from '@/components/ui/icon-action'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { t } from '@/lib/i18n'
import { dismissKeyboard, isKeyboardVisible } from '@/lib/keyboard'
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
      /** Peek slot, shown at the tall detent. Called inline only while peeking, so no hooks. */
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

// visibility, not display: none, which drops a scroller's offset; pointer events and the
// accessibility tree are cut separately, as native has no visibility.
const HIDDEN_LAYER = {
  ...Platform.select({ web: { visibility: 'hidden' }, default: { opacity: 0 } }),
  pointerEvents: 'none',
} as const

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
  const insets = useSafeAreaInsets()
  const [sheet, setSheet] = useState<RailSheetState>(RAIL_SHEET_OPENED)
  const send = (event: RailSheetEvent) => setSheet((current) => reduceRailSheet(current, event))

  // The list's viewport at the list level. The tall peek detent would grow it, and a list
  // scrolled to its end clamps its offset to the bigger viewport; capping the list at its old
  // height keeps the offset. The cap outlives `←`: it equals the list level's height, and
  // releasing it relayouts the list mid-settle, when gorhom's scroll lock resets the offset.
  const listHeight = useRef(0)
  const { height: windowHeight } = useWindowDimensions()
  const [cap, setCap] = useState<{ height: number; windowHeight: number } | null>(null)
  // A window that changed under the peek makes the recorded height wrong for the new layout.
  const heightCap = cap != null && cap.windowHeight === windowHeight ? cap.height : null

  // The Sheet presents a tick after `open` flips, so this lands before anything renders.
  useEffect(() => {
    if (open) {
      setSheet(RAIL_SHEET_OPENED)
      setCap(null)
    }
  }, [open])

  const peeking = sheet.content === 'peek'

  const handleRowPress = (category: RailCategory, id: string) => {
    if (renderPeek == null) {
      onRowPress(category, id)
      return
    }
    // The search field keeps focus under the hidden list, so the keyboard goes down with the
    // tap; its shortened list is no height to restore.
    const keyboardUp = Platform.OS !== 'web' && isKeyboardVisible()
    if (keyboardUp) void dismissKeyboard()
    setCap(
      listHeight.current > 0 && !keyboardUp ? { height: listHeight.current, windowHeight } : null,
    )
    send({ type: 'openPeek', peek: { category, id } })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} ariaLabel={t('reader:rail.label')}>
      <SheetContent
        anchor="bottom"
        size={sheet.size}
        // One value for both detents: gorhom's content can stop scrolling when it changes while
        // open. The peek level, the only one 'extend' would pick, holds no field.
        keyboardBehavior="interactive"
        className="p-0"
        // The primitive pads the inset plus p-6's 24px inline, which p-0 can't override.
        style={{ paddingBottom: insets.bottom }}
      >
        {sheet.content === 'categories' ? (
          <RailSheetCategories
            value={view.category}
            tints={data.categoryTint}
            onPick={(category) => {
              onCategoryChange(category)
              send({ type: 'pickCategory' })
            }}
          />
        ) : (
          <View
            className="flex-1"
            onLayout={(event) => {
              if (heightCap == null) listHeight.current = event.nativeEvent.layout.height
            }}
          >
            {/* Mounted under the peek so `←` finds the list as it was left, scroll included. */}
            <View
              testID="rail-sheet-list-layer"
              className="flex-1"
              style={[
                peeking ? HIDDEN_LAYER : null,
                heightCap != null ? { maxHeight: heightCap } : null,
              ]}
              aria-hidden={peeking}
              importantForAccessibility={peeking ? 'no-hide-descendants' : 'auto'}
            >
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
            {sheet.content === 'peek' ? (
              <View style={StyleSheet.absoluteFill}>
                {renderPeek?.(sheet.peek, () => send({ type: 'back' })) ?? null}
              </View>
            ) : null}
          </View>
        )}
      </SheetContent>
    </Sheet>
  )
}
