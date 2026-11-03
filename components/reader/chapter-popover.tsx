import { SCROLLABLE_STATUS, useBottomSheetInternal } from '@gorhom/bottom-sheet'
import type { TriggerRef } from '@rn-primitives/popover'
import { useImperativeHandle, useRef, useState, type ReactElement, type Ref } from 'react'
import {
  Platform,
  Pressable,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
} from 'react-native'
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler'
import { useAnimatedReaction } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { ChapterProgressBar } from '@/components/compounds/chapter-progress-bar'
import { chapterProgressLabel } from '@/components/compounds/chapter-progress-label'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  ContextScrollView,
  ScrollComponentContext,
  type ScrollComponent,
  type ScrollComponentHandle,
} from '@/components/ui/scroll-component'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import type { ChapterProgress } from '@/lib/chapters'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

import { ChapterChip } from './chapter-chip'

export type ChapterPopoverRow = {
  id: string
  /** The chapter's own `sequenceNumber`, unlike a break's, which names the next chapter. */
  number: number
  title: string
  rangeLabel: string | null
  startEntryId: string
}

export type ChapterPopoverHandle = {
  /** Opens the Popover at tablet and desktop; a no-op on phone, where the Sheet opens from its own chip. */
  open: () => void
  close: () => void
}

export type ChapterPopoverProps = {
  /** The open chapter's number: `openChapterNumber(...)`. */
  number: number
  /** Oldest first. */
  closed: readonly ChapterPopoverRow[]
  sinceLabel: string | null
  progress: ChapterProgress
  onOpenChange?: (open: boolean) => void
  onJumpToChapter: (startEntryId: string) => void
  /** Absent: disabled with a reason. */
  onCloseChapter?: () => void
  /** Absent: disabled with a reason. */
  onManageChapters?: () => void
  ref?: Ref<ChapterPopoverHandle>
}

type Arm = { root: string; row: string; list: ViewStyle }

// A list needs a bound to scroll: PopoverContent has no cap on web, and a Sheet's list takes what
// its detent leaves over.
const POPOVER_ARM: Arm = { root: 'gap-3 p-3', row: 'min-h-control-md', list: { maxHeight: 320 } }
// rn-primitives' Popover content claims the touch responder, which stalls a plain ScrollView on
// Android; gesture-handler's doesn't use the responder system.
const POPOVER_SCROLL = GestureScrollView as ScrollComponent
const SHEET_ARM: Arm = { root: 'flex-1 gap-3', row: 'min-h-control-lg', list: { flex: 1 } }

/** Popover on desktop and tablet, a medium bottom Sheet on phone, each opened from its own chip. */
export function ChapterPopover(props: ChapterPopoverProps): ReactElement {
  const isPhone = useTier() === 'phone'
  return isPhone ? <SheetArm {...props} /> : <PopoverArm {...props} />
}

// TriggerRef.close() calls onOpenChange on a closed popover too; only a change is reported.
function useReportedOpen(onOpenChange: ChapterPopoverProps['onOpenChange']) {
  const [open, setOpen] = useState(false)
  const change = (next: boolean) => {
    if (next === open) return
    setOpen(next)
    onOpenChange?.(next)
  }
  return [open, change] as const
}

function PopoverArm({ onOpenChange, ref, ...content }: ChapterPopoverProps) {
  const trigger = useRef<TriggerRef>(null)
  const lastClosedRow = useRef<View>(null)
  const [open, changeOpen] = useReportedOpen(onOpenChange)
  const close = () => trigger.current?.close()

  // Radix's default is the first row, far above the last one the list opens on.
  const focusLastClosedRow = (event: Event) => {
    if (lastClosedRow.current == null) return
    event.preventDefault()
    lastClosedRow.current.focus()
  }

  useImperativeHandle(ref, () => ({ open: () => trigger.current?.open(), close }))

  return (
    <Popover
      ariaLabel={t('chapters:popover.title')}
      onOpenChange={changeOpen}
      onOpenAutoFocus={focusLastClosedRow}
    >
      <PopoverTrigger ref={trigger} asChild>
        <ChapterChip number={content.number} expanded={open} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <ScrollComponentContext.Provider value={POPOVER_SCROLL}>
          <OverlayBody {...content} arm={POPOVER_ARM} close={close} lastClosedRow={lastClosedRow} />
        </ScrollComponentContext.Provider>
      </PopoverContent>
    </Popover>
  )
}

function SheetArm({ onOpenChange, ref, ...content }: ChapterPopoverProps) {
  const [open, changeOpen] = useReportedOpen(onOpenChange)
  const close = () => changeOpen(false)

  useImperativeHandle(ref, () => ({ open: () => {}, close }))

  return (
    <Sheet open={open} onOpenChange={changeOpen} ariaLabel={t('chapters:popover.title')}>
      <SheetTrigger asChild>
        <ChapterChip number={content.number} expanded={open} />
      </SheetTrigger>
      <SheetContent size="medium">
        <OverlayBody {...content} arm={SHEET_ARM} close={close} />
      </SheetContent>
    </Sheet>
  )
}

// gorhom snaps its scrollable back to the top on any scroll until the sheet is fully up, so the
// open-on-last-row scroll has to be repeated when it unlocks.
function SheetUnlockWatcher({ onUnlocked }: { onUnlocked: () => void }) {
  const { animatedScrollableStatus } = useBottomSheetInternal()
  useAnimatedReaction(
    () => animatedScrollableStatus.get() === SCROLLABLE_STATUS.UNLOCKED,
    (unlocked, previous) => {
      if (unlocked && !previous) scheduleOnRN(onUnlocked)
    },
  )
  return null
}

type OverlayBodyProps = Omit<ChapterPopoverProps, 'onOpenChange' | 'ref'> & {
  arm: Arm
  close: () => void
  lastClosedRow?: Ref<View>
}

function OverlayBody({
  number,
  closed,
  sinceLabel,
  progress,
  onJumpToChapter,
  onCloseChapter,
  onManageChapters,
  arm,
  close,
  lastClosedRow,
}: OverlayBodyProps) {
  const list = useRef<ScrollComponentHandle>(null)
  const contentHeight = useRef(0)
  // Both overlays mount this body on each open, so a new open pins again.
  const pinned = useRef(true)
  // ScrollComponentHandle exposes only scrollTo, so the end is the measured content height.
  const scrollToEnd = () => {
    if (pinned.current) list.current?.scrollTo({ y: contentHeight.current, animated: false })
  }
  // Web has no drag, and a wheel, key or scrollbar can each move the list. Only the reader moves
  // it up: the list's own scrolls go down to the end, rows growing below move nothing, and a move
  // up that ends at the end is a clamp (the list shrank or its viewport grew), not input.
  const lastOffset = useRef(0)
  const unpinOnScrollUp = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    const atEnd = contentOffset.y >= contentSize.height - layoutMeasurement.height - 1
    if (contentOffset.y < lastOffset.current - 1 && !atEnd) pinned.current = false
    lastOffset.current = contentOffset.y
  }
  // Android runs a frame's view commands before its mount, so a scroll for rows that just grew
  // clamps to their old height; the next frame's repeat lands after the mount.
  const showLastRow = () => {
    scrollToEnd()
    requestAnimationFrame(scrollToEnd)
  }

  return (
    <View className={arm.root}>
      {arm === SHEET_ARM ? <SheetUnlockWatcher onUnlocked={showLastRow} /> : null}
      <ContextScrollView
        ref={list}
        testID="chapter-popover-list"
        keyboardShouldPersistTaps="handled"
        // A touch drag keeps the reader's place: no later trigger pulls it back.
        onScrollBeginDrag={() => {
          pinned.current = false
        }}
        onScroll={Platform.OS === 'web' ? unpinOnScrollUp : undefined}
        // RN-Web's default reports only a scroll's start and its end, 100 ms after it stops.
        scrollEventThrottle={16}
        style={arm.list}
        onContentSizeChange={(_width, height) => {
          contentHeight.current = height
          showLastRow()
        }}
        // gorhom takes its handle's height off the list after the content has laid out.
        onLayout={showLastRow}
      >
        {closed.map((row, index) => (
          <ClosedRow
            key={row.id}
            ref={index === closed.length - 1 ? lastClosedRow : undefined}
            row={row}
            className={arm.row}
            onPress={() => {
              close()
              onJumpToChapter(row.startEntryId)
            }}
          />
        ))}
        <View
          testID="chapter-popover-open"
          className={cn(ROW_CLASS, arm.row, 'rounded-sm bg-tint-press')}
        >
          <Text size="sm" className="font-medium">
            {t('chapters:popover.inProgress', { number })}
          </Text>
          {sinceLabel != null ? (
            <Text size="xs" variant="muted" numberOfLines={1}>
              {t('chapters:popover.since', { time: sinceLabel })}
            </Text>
          ) : null}
        </View>
      </ContextScrollView>

      <View className="gap-1">
        <ChapterProgressBar
          percent={progress.percent}
          tone={progress.tone}
          className="h-1.5 rounded-full"
        />
        <Text size="xs" variant="muted">
          {chapterProgressLabel(progress)}
        </Text>
      </View>

      <View className="gap-1">
        <OverlayAction
          label={t('chapters:popover.closeManually')}
          reason={t('chapters:popover.closeLandsLater')}
          variant="primary"
          onPress={onCloseChapter}
          close={close}
        />
        <OverlayAction
          label={t('chapters:popover.manage')}
          reason={t('chrome.goTo.chapterTimelineLandsLater')}
          variant="ghost"
          onPress={onManageChapters}
          close={close}
        />
      </View>
    </View>
  )
}

const ROW_CLASS = 'justify-center gap-0.5 px-row-x-md py-row-y-sm'

function ClosedRow({
  row,
  className,
  onPress,
  ref,
}: {
  row: ChapterPopoverRow
  className: string
  onPress: () => void
  ref?: Ref<View>
}) {
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      onPress={onPress}
      className={cn(
        ROW_CLASS,
        className,
        'rounded-sm active:bg-tint-press',
        Platform.select({
          web: 'cursor-pointer outline-none hover:bg-tint-hover focus-visible:ring-2 focus-visible:ring-focus-ring',
        }),
      )}
    >
      <Text size="sm" numberOfLines={1}>
        {t('chapters:popover.closedRow', { number: row.number, title: row.title })}
      </Text>
      {row.rangeLabel != null ? (
        <Text size="xs" variant="muted">
          {row.rangeLabel}
        </Text>
      ) : null}
    </Pressable>
  )
}

function OverlayAction({
  label,
  reason,
  variant,
  onPress,
  close,
}: {
  label: string
  reason: string
  variant: 'primary' | 'ghost'
  onPress: (() => void) | undefined
  close: () => void
}) {
  return (
    <View className="gap-0.5">
      <Button
        variant={variant}
        size="sm"
        disabled={onPress == null}
        disabledReason={reason}
        onPress={() => {
          close()
          onPress?.()
        }}
      >
        <Text>{label}</Text>
      </Button>
      {onPress == null && Platform.OS !== 'web' ? (
        <Text size="xs" variant="muted">
          {reason}
        </Text>
      ) : null}
    </View>
  )
}
