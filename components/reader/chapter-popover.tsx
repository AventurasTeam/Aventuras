import { SCROLLABLE_STATUS, useBottomSheetInternal } from '@gorhom/bottom-sheet'
import type { TriggerRef } from '@rn-primitives/popover'
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react'
import {
  Platform,
  Pressable,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
} from 'react-native'
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler'
import { useAnimatedReaction, useSharedValue } from 'react-native-reanimated'
import { runOnUISync, scheduleOnRN } from 'react-native-worklets'

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
import { openChapterNumber, type ChapterProgress } from '@/lib/chapters'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

import { ChapterChip } from './chapter-chip'
import { PinnedEndContext, useEndLockedScrollHandlers } from './sheet-list-lock'

export type ChapterPopoverRow = {
  id: string
  /** The chapter's own `sequenceNumber`, unlike a break's, which names the next chapter. */
  number: number
  title: string
  rangeLabel: string | null
  startEntryId: string
}

export type ChapterPopoverHandle = {
  /**
   * Opens the Popover at tablet and desktop; a no-op on phone, where the Sheet opens from its own
   * chip, and in a press that began outside the open Popover, which that press closes.
   */
  open: () => void
  close: () => void
}

export type ChapterPopoverProps = {
  /** Oldest first. */
  closed: readonly ChapterPopoverRow[]
  sinceLabel: string | null
  /** Its `startEntryId` is the open row's jump; null leaves that row unpressable. */
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

// A list needs a bound to scroll: 320 on a popover, which shrinks it in a short window so the
// actions stay on screen; a Sheet's list takes what its detent leaves over.
const POPOVER_ARM: Arm = {
  root: 'min-h-0 shrink gap-3 p-3',
  row: 'min-h-control-md',
  list: { maxHeight: 320, flexShrink: 1 },
}
// rn-primitives' Popover content claims the touch responder, which stalls a plain ScrollView on
// Android; gesture-handler's doesn't use the responder system.
const POPOVER_SCROLL = GestureScrollView as ScrollComponent
const SHEET_ARM: Arm = { root: 'flex-1 gap-3', row: 'min-h-control-lg', list: { flex: 1 } }
// gorhom takes its handler hook as a prop; at module scope it stays out of the compiler's way.
const END_HELD_LIST = { scrollEventsHandlersHook: useEndLockedScrollHandlers }

type ArmProps = ChapterPopoverProps & { number: number }

/** Popover on desktop and tablet, a medium bottom Sheet on phone, each opened from its own chip. */
export function ChapterPopover(props: ChapterPopoverProps): ReactElement {
  const isPhone = useTier() === 'phone'
  const number = openChapterNumber(props.closed.map((row) => ({ sequenceNumber: row.number })))
  return isPhone ? (
    <SheetArm {...props} number={number} />
  ) : (
    <PopoverArm {...props} number={number} />
  )
}

// TriggerRef.close() calls onOpenChange on a closed popover too; only a change is reported.
function useReportedOpen(onOpenChange: ChapterPopoverProps['onOpenChange']) {
  const [open, setOpen] = useState(false)
  const change = (next: boolean) => {
    if (next === open) return
    setOpen(next)
    onOpenChange?.(next)
  }
  // A tier flip swaps the arms, and the open one unmounts without closing.
  const committed = useRef({ open, onOpenChange })
  useEffect(() => {
    committed.current = { open, onOpenChange }
  })
  useEffect(
    () => () => {
      if (committed.current.open) committed.current.onOpenChange?.(false)
    },
    [],
  )
  return [open, change] as const
}

// Radix closes on an outside pointerdown, before the click: an opener outside would reopen what its
// own press just closed, where the chip toggles. Web only; a native overlay takes that press.
function usePressStartedOutside() {
  const started = useRef(false)
  useEffect(() => {
    if (Platform.OS !== 'web') return
    const reset = () => {
      started.current = false
    }
    document.addEventListener('pointerdown', reset, true)
    document.addEventListener('keydown', reset, true)
    return () => {
      document.removeEventListener('pointerdown', reset, true)
      document.removeEventListener('keydown', reset, true)
    }
  }, [])
  return {
    mark: () => {
      started.current = true
    },
    started: () => started.current,
  }
}

function PopoverArm({ onOpenChange, ref, ...content }: ArmProps) {
  const trigger = useRef<TriggerRef>(null)
  const lastRow = useRef<View>(null)
  const [open, changeOpen] = useReportedOpen(onOpenChange)
  const pressStartedOutside = usePressStartedOutside()
  const close = () => trigger.current?.close()

  // Radix's default is the first row, far above the last one the list opens on.
  const focusLastRow = (event: Event) => {
    if (lastRow.current == null) return
    event.preventDefault()
    lastRow.current.focus()
  }

  // Radix returns focus to the trigger; a popover the handle opened returns it to what opened it.
  // Neither does after an outside press or focus, which has put focus where the user wanted it.
  const opener = useRef<HTMLElement | null>(null)
  const interactedOutside = useRef(false)
  const returnFocusToOpener = (event: Event) => {
    const target = opener.current
    opener.current = null
    const outside = interactedOutside.current
    interactedOutside.current = false
    if (outside || target == null || !target.isConnected) return
    event.preventDefault()
    target.focus()
  }

  useImperativeHandle(ref, () => ({
    open: () => {
      if (pressStartedOutside.started()) return
      if (Platform.OS === 'web') {
        const active = document.activeElement
        opener.current = active instanceof HTMLElement && active !== document.body ? active : null
      }
      trigger.current?.open()
    },
    close,
  }))

  return (
    <Popover
      ariaLabel={t('chapters:popover.title')}
      onOpenChange={changeOpen}
      onOpenAutoFocus={focusLastRow}
      onCloseAutoFocus={returnFocusToOpener}
    >
      <PopoverTrigger ref={trigger} asChild>
        <ChapterChip number={content.number} expanded={open} />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-0"
        onPointerDownOutside={pressStartedOutside.mark}
        onInteractOutside={() => {
          interactedOutside.current = true
        }}
      >
        <ScrollComponentContext.Provider value={POPOVER_SCROLL}>
          <OverlayBody {...content} arm={POPOVER_ARM} close={close} lastRow={lastRow} />
        </ScrollComponentContext.Provider>
      </PopoverContent>
    </Popover>
  )
}

function SheetArm({ onOpenChange, ref, ...content }: ArmProps) {
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

// The hold comes from measured heights, so the open-on-last-row scroll repeats once gorhom
// unlocks, landing on the scroll view's own end.
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

type OverlayBodyProps = Omit<ArmProps, 'onOpenChange' | 'ref'> & {
  arm: Arm
  close: () => void
  /** The last pressable row, which takes focus on open. */
  lastRow?: Ref<View>
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
  lastRow,
}: OverlayBodyProps) {
  const list = useRef<ScrollComponentHandle>(null)
  const contentHeight = useRef(0)
  const viewportHeight = useRef(0)
  // Both overlays mount this body on each open, so a new open pins again.
  const pinned = useRef(true)
  // Native Sheet only: gorhom holds the list while the Sheet moves, at the end while it's pinned.
  const sheetHeld = arm === SHEET_ARM && Platform.OS !== 'web'
  const pinnedEnd = useSharedValue(-1)
  const holdAtEnd = () => {
    if (!sheetHeld) return
    const end = pinned.current ? Math.max(0, contentHeight.current - viewportHeight.current) : -1
    // Synchronous, so the scroll that follows is held where this says.
    runOnUISync(() => {
      'worklet'
      pinnedEnd.value = end
    })
  }
  const unpin = () => {
    pinned.current = false
    holdAtEnd()
  }
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
    if (contentOffset.y < lastOffset.current - 1 && !atEnd) unpin()
    lastOffset.current = contentOffset.y
  }
  // Android runs a frame's view commands before its mount, so a scroll for rows that just grew
  // clamps to their old height; the next frame's repeat lands after the mount.
  const showLastRow = () => {
    scrollToEnd()
    requestAnimationFrame(scrollToEnd)
  }
  const jump = (startEntryId: string) => () => {
    close()
    onJumpToChapter(startEntryId)
  }
  const openStart = progress.startEntryId

  return (
    <View className={arm.root}>
      {arm === SHEET_ARM ? <SheetUnlockWatcher onUnlocked={showLastRow} /> : null}
      <PinnedEndContext.Provider value={sheetHeld ? pinnedEnd : null}>
        <ContextScrollView
          ref={list}
          testID="chapter-popover-list"
          keyboardShouldPersistTaps="handled"
          {...(sheetHeld ? END_HELD_LIST : {})}
          // A touch drag keeps the reader's place: no later trigger pulls it back.
          onScrollBeginDrag={unpin}
          onScroll={Platform.OS === 'web' ? unpinOnScrollUp : undefined}
          // RN-Web's default reports only a scroll's start and its end, 100 ms after it stops.
          scrollEventThrottle={16}
          style={arm.list}
          onContentSizeChange={(_width, height) => {
            contentHeight.current = height
            holdAtEnd()
            showLastRow()
          }}
          // gorhom takes its handle's height off the list after the content has laid out.
          onLayout={(event) => {
            viewportHeight.current = event.nativeEvent.layout.height
            holdAtEnd()
            showLastRow()
          }}
        >
          {closed.map((row, index) => (
            <ChapterRow
              key={row.id}
              ref={openStart == null && index === closed.length - 1 ? lastRow : undefined}
              className={arm.row}
              onPress={jump(row.startEntryId)}
            >
              <Text size="sm" numberOfLines={1}>
                {t('chapters:popover.closedRow', { number: row.number, title: row.title })}
              </Text>
              {row.rangeLabel != null ? (
                <Text size="xs" variant="muted">
                  {row.rangeLabel}
                </Text>
              ) : null}
            </ChapterRow>
          ))}
          <ChapterRow
            ref={openStart != null ? lastRow : undefined}
            testID="chapter-popover-open"
            className={arm.row}
            onPress={openStart != null ? jump(openStart) : undefined}
          >
            <Text size="sm" className="font-medium">
              {t('chapters:popover.inProgress', { number })}
            </Text>
            {sinceLabel != null ? (
              <Text size="xs" variant="muted" numberOfLines={1}>
                {t('chapters:popover.since', { time: sinceLabel })}
              </Text>
            ) : null}
          </ChapterRow>
        </ContextScrollView>
      </PinnedEndContext.Provider>

      <View className="gap-1">
        <ChapterProgressBar percent={progress.percent} className="h-1.5 rounded-full" />
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

/** Pressable with an `onPress`, plain without: an open chapter with no entry yet has no jump. */
function ChapterRow({
  className,
  onPress,
  testID,
  ref,
  children,
}: {
  className: string
  onPress?: () => void
  testID?: string
  ref?: Ref<View>
  children: ReactNode
}) {
  if (onPress == null) {
    return (
      <View testID={testID} className={cn(ROW_CLASS, className)}>
        {children}
      </View>
    )
  }
  return (
    <Pressable
      ref={ref}
      testID={testID}
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
      {children}
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
