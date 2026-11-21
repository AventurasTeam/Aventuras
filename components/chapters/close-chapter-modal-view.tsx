import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronUp } from 'lucide-react-native'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { FlatList, Platform, Pressable, View, type ViewStyle } from 'react-native'

import { ReasonButton } from '@/components/compounds/reason-button'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Icon } from '@/components/ui/icon'
import { ABOVE_SHEETS_PORTAL_HOST } from '@/components/ui/sheet'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export type CloseModalRow = {
  id: string
  /** formatEntryRef's label, e.g. the entry's number as Plot shows it. */
  ref: string
  excerpt: string
  /** Formatted world time; null shows none. */
  time: string | null
}

export type CloseChapterModalViewProps = {
  open: boolean
  start: (CloseModalRow & { endedChapterNumber: number | null }) | null
  /** Rows passing canEndChapter, newest first: the first is the one tagged latest. */
  replies: readonly CloseModalRow[]
  selectedId: string | null
  tokensInRange: number
  /** Set while the gate holds: Close chapter disables with it. */
  disabledReason?: string
  onSelect: (entryId: string) => void
  onConfirm: () => void
  onCancel: () => void
}

// chapter-timeline.md → End-entry picker: the panel scrolls past ~320 px. As the dialog's one
// scroll region it also shrinks below that in a short window, so the foot stays on screen.
const PANEL_MAX_HEIGHT = 320
const PANEL_WEB_STYLE: CSSProperties = { maxHeight: PANEL_MAX_HEIGHT }
const PANEL_NATIVE_STYLE: ViewStyle = { maxHeight: PANEL_MAX_HEIGHT, flexShrink: 1 }
const REPLY_ROW_ESTIMATE = 64

const ROW_CARD = 'rounded-md border border-border px-3 py-2'
const PRESSABLE_WEB =
  'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'

function trackStyle(height: number): CSSProperties {
  return { position: 'relative', width: '100%', height }
}

function slotStyle(top: number): CSSProperties {
  return { position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${top}px)` }
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text size="xs" variant="muted" className="uppercase tracking-wide">
      {children}
    </Text>
  )
}

/**
 * chapter-timeline.md → Entry-row anatomy: the start row's and the picker trigger's line. Phone
 * stacks ref and tag over snippet and time; wider tiers keep one line.
 */
function EntryLine({
  row,
  tag,
  trailing,
}: {
  row: CloseModalRow
  tag: string | null
  trailing?: ReactNode
}) {
  const phone = useTier() === 'phone'
  const ref = (
    <Text size="xs" variant="muted" className="shrink-0 font-mono">
      {row.ref}
    </Text>
  )
  const tagChip =
    tag != null ? (
      <Tag tone="soft" className="shrink-0">
        {tag}
      </Tag>
    ) : null
  // w-0: a nowrap snippet's min-content is its full width, which would widen the dialog past the
  // window.
  const snippet = (
    <Text size="sm" variant="secondary" numberOfLines={1} className="w-0 min-w-0 flex-1 italic">
      {row.excerpt}
    </Text>
  )
  const time =
    row.time != null ? (
      <Text size="xs" variant="muted" className="shrink-0">
        {row.time}
      </Text>
    ) : null
  if (phone) {
    return (
      <View className="gap-1">
        <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
          {ref}
          {tagChip}
          <View className="flex-1" />
          {trailing}
        </View>
        <View className="flex-row items-center gap-2">
          {snippet}
          {time}
        </View>
      </View>
    )
  }
  return (
    <View className="flex-row items-center gap-2">
      {ref}
      {tagChip}
      {snippet}
      {time}
      {trailing}
    </View>
  )
}

/** chapter-timeline.md → End-entry picker: a panel item's two lines. */
function ReplyRow({
  row,
  latest,
  selected,
  onPress,
}: {
  row: CloseModalRow
  latest: boolean
  selected: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      testID={`close-chapter-reply-${row.id}`}
      role="option"
      aria-selected={selected}
      onPress={onPress}
      className={cn(
        'gap-1 border-b border-border px-3 py-2 active:bg-tint-press',
        Platform.select({ web: cn(PRESSABLE_WEB, !selected && 'hover:bg-tint-hover') }),
        selected && 'bg-bg-sunken',
      )}
    >
      <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
        <Text size="xs" variant="muted" className="shrink-0 font-mono">
          {row.ref}
        </Text>
        {latest ? <Tag tone="soft">{t('chapters:closeModal.latest')}</Tag> : null}
        {/* ml-auto keeps the time at the right, on its own line when the head wraps. */}
        {row.time != null ? (
          <Text size="xs" variant="muted" className="ml-auto shrink-0">
            {row.time}
          </Text>
        ) : null}
      </View>
      <Text size="sm" variant="secondary" numberOfLines={2} className="italic">
        {row.excerpt}
      </Text>
    </Pressable>
  )
}

type PanelProps = {
  replies: readonly CloseModalRow[]
  latestId: string | null
  selectedId: string | null
  onPick: (entryId: string) => void
}

function stepIndex(key: string, from: number, count: number): number | null {
  switch (key) {
    case 'ArrowDown':
      return Math.min(from + 1, count - 1)
    case 'ArrowUp':
      return Math.max(from - 1, 0)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

function ReplyPanelWeb({ replies, latestId, selectedId, onPick }: PanelProps) {
  // TanStack Virtual's instance mutates in place; compiled memos keyed on it would go stale.
  'use no memo'
  const scrollRef = useRef<HTMLDivElement>(null)
  // Measured heights keyed as the rows are, so a reply landing above keeps the others' heights.
  // Stable per list: the virtualizer rebuilds every measurement when the function changes.
  const itemKey = useCallback((index: number) => replies[index]!.id, [replies])
  const virtualizer = useVirtualizer({
    count: replies.length,
    getItemKey: itemKey,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => REPLY_ROW_ESTIMATE,
    overscan: 6,
  })
  // It opens on the selection, which a `Close chapter here` pick leaves far below the newest reply.
  const openedOn = useRef(replies.findIndex((row) => row.id === selectedId))
  useEffect(() => {
    if (openedOn.current > 0) virtualizer.scrollToIndex(openedOn.current, { align: 'center' })
  }, [virtualizer])
  // A key can target an option virtualized out: it takes focus once the scroll has mounted it.
  const pendingFocus = useRef<string | null>(null)
  const focusPending = () => {
    const id = pendingFocus.current
    if (id == null) return
    // A removed option's blur is dropped mid-commit, so the request can outlive a focus that left.
    const active = document.activeElement
    const index = replies.findIndex((row) => row.id === id)
    if (index < 0 || (active !== document.body && !scrollRef.current?.contains(active))) {
      pendingFocus.current = null
      return
    }
    const option = scrollRef.current?.querySelector<HTMLElement>(
      `[data-index="${index}"] [role="option"]`,
    )
    if (option == null) return
    pendingFocus.current = null
    option.focus()
  }
  useEffect(focusPending)
  const spaceDownOn = useRef<HTMLElement | null>(null)
  const slotIndex = (event: KeyboardEvent<HTMLDivElement>) => {
    const slot = (event.target as HTMLElement).closest<HTMLElement>('[data-index]')
    return slot == null ? null : Number(slot.dataset.index)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = slotIndex(event)
    if (from == null) return
    // RN-Web presses an option on Enter only, so Space is ours. It picks on release, as Enter
    // does: picking on press hands its repeats to the trigger, whose Space press reopens the panel.
    if (event.key === ' ') {
      event.preventDefault()
      // A repeat is no press: after a focus loss it would arm a release that began elsewhere.
      if (!event.repeat) spaceDownOn.current = event.target as HTMLElement
      return
    }
    const to = stepIndex(event.key, from, replies.length)
    if (to == null) return
    event.preventDefault()
    virtualizer.scrollToIndex(to, { align: 'auto' })
    pendingFocus.current = replies[to]!.id
    focusPending()
  }
  const onKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== ' ') return
    const downOn = spaceDownOn.current
    spaceDownOn.current = null
    const from = slotIndex(event)
    // The armed node, not its id: a reply that virtualized out and back is a new node.
    if (from == null || event.target !== downOn) return
    onPick(replies[from]!.id)
  }
  // Leaving the panel drops what was armed in it: a release outside never reaches onKeyUp, and a
  // pending focus would pull focus back from wherever it went once its reply mounts. A removed
  // option's blur fires mid-commit, where React drops it, so End's own scroll keeps its pending
  // focus; a native focusout listener would see that blur and break End.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    spaceDownOn.current = null
    pendingFocus.current = null
  }
  return (
    <div
      ref={scrollRef}
      role="listbox"
      aria-label={t('chapters:closeModal.endHeading')}
      data-testid="close-chapter-panel"
      className="min-h-0 shrink overflow-y-auto overflow-x-hidden rounded-md border border-border"
      style={PANEL_WEB_STYLE}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={onBlur}
    >
      <div style={trackStyle(virtualizer.getTotalSize())}>
        {virtualizer.getVirtualItems().map((slot) => {
          const row = replies[slot.index]!
          return (
            <div
              key={row.id}
              ref={virtualizer.measureElement}
              data-index={slot.index}
              style={slotStyle(slot.start)}
            >
              <ReplyRow
                row={row}
                latest={row.id === latestId}
                selected={row.id === selectedId}
                onPress={() => onPick(row.id)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ReplyPanelNative({ replies, latestId, selectedId, onPick }: PanelProps) {
  const listRef = useRef<FlatList<CloseModalRow>>(null)
  const openedOn = useRef(replies.findIndex((row) => row.id === selectedId))
  const retried = useRef(false)
  const scrollToOpened = () =>
    listRef.current?.scrollToIndex({ index: openedOn.current, viewPosition: 0.5, animated: false })
  useEffect(() => {
    if (openedOn.current > 0) scrollToOpened()
  }, [])
  return (
    <View className="min-h-0 shrink overflow-hidden rounded-md border border-border">
      <FlatList
        ref={listRef}
        // Rows vary in height, so a target past the measured cells fails: jump to its estimated
        // offset so the list renders it, then retry once.
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false })
          if (retried.current) return
          retried.current = true
          requestAnimationFrame(scrollToOpened)
        }}
        testID="close-chapter-panel"
        accessibilityLabel={t('chapters:closeModal.endHeading')}
        data={replies}
        keyExtractor={(row) => row.id}
        extraData={selectedId}
        keyboardShouldPersistTaps="handled"
        style={PANEL_NATIVE_STYLE}
        renderItem={({ item }) => (
          <ReplyRow
            row={item}
            latest={item.id === latestId}
            selected={item.id === selectedId}
            onPress={() => onPick(item.id)}
          />
        )}
      />
    </View>
  )
}

// Inside DialogContent's Portal, so the panel's state resets each time the dialog opens.
function CloseModalBody({
  start,
  replies,
  selectedId,
  tokensInRange,
  disabledReason,
  onSelect,
  onConfirm,
  onCancel,
}: CloseChapterModalViewProps) {
  const [panelOpen, setPanelOpen] = useState(false)
  const triggerRef = useRef<View>(null)
  const latestId = replies[0]?.id ?? null
  const selected = replies.find((row) => row.id === selectedId) ?? null
  const pick = (entryId: string) => {
    onSelect(entryId)
    setPanelOpen(false)
    // The picked option unmounts with the panel; focus would fall to the dialog, not the trigger.
    if (Platform.OS === 'web') triggerRef.current?.focus()
  }
  const panelProps: PanelProps = { replies, latestId, selectedId, onPick: pick }
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('chapters:closeModal.title')}</DialogTitle>
      </DialogHeader>
      {start != null ? (
        <DialogDescription className="text-fg-secondary">
          {t('chapters:closeModal.framing', { start: start.ref })}
        </DialogDescription>
      ) : null}
      {start != null ? (
        <View className="gap-1.5">
          <SectionLabel>{t('chapters:closeModal.startHeading')}</SectionLabel>
          <View testID="close-chapter-start" className={ROW_CARD}>
            <EntryLine
              row={start}
              tag={
                start.endedChapterNumber == null
                  ? null
                  : t('chapters:closeModal.chapterEndedHere', { number: start.endedChapterNumber })
              }
            />
          </View>
        </View>
      ) : null}
      <View className="min-h-0 shrink gap-1.5">
        <SectionLabel>{t('chapters:closeModal.endHeading')}</SectionLabel>
        {selected != null ? (
          <Pressable
            ref={triggerRef}
            testID="close-chapter-picker"
            role="button"
            aria-haspopup="listbox"
            aria-expanded={panelOpen}
            onPress={() => setPanelOpen((was) => !was)}
            className={cn(
              ROW_CARD,
              'active:bg-tint-press',
              Platform.select({ web: cn(PRESSABLE_WEB, 'hover:bg-tint-hover') }),
            )}
          >
            <EntryLine
              row={selected}
              tag={selected.id === latestId ? t('chapters:closeModal.latest') : null}
              trailing={
                <Icon
                  as={panelOpen ? ChevronUp : ChevronDown}
                  size="sm"
                  className="shrink-0 text-fg-muted"
                />
              }
            />
          </Pressable>
        ) : null}
        {panelOpen ? (
          Platform.OS === 'web' ? (
            <ReplyPanelWeb {...panelProps} />
          ) : (
            <ReplyPanelNative {...panelProps} />
          )
        ) : null}
      </View>
      <Text testID="close-chapter-tokens" size="sm" variant="muted">
        {t('chapters:closeModal.tokensInRange', { count: tokensInRange })}
      </Text>
      <DialogFooter>
        <Button variant="secondary" onPress={onCancel}>
          <Text>{t('chapters:closeModal.cancel')}</Text>
        </Button>
        <ReasonButton
          layout="stretch"
          variant="primary"
          disabled={disabledReason != null || selected == null}
          disabledReason={disabledReason}
          onPress={onConfirm}
        >
          <Text>{t('chapters:closeModal.confirm')}</Text>
        </ReasonButton>
      </DialogFooter>
    </>
  )
}

/**
 * chapter-timeline.md → Chapter-close modal: a Modal at every tier, the end picker in-flow. The
 * selection is the caller's; the panel's open state is the view's own.
 */
export function CloseChapterModalView(props: CloseChapterModalViewProps): ReactElement {
  const { open, onCancel, disabledReason } = props
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      {/* Opened from a Sheet still animating out, it must draw above that Sheet. */}
      <DialogContent
        busy={disabledReason != null}
        portalHost={ABOVE_SHEETS_PORTAL_HOST}
        scrollable={false}
        className="sm:max-w-[480px]"
      >
        <CloseModalBody {...props} />
      </DialogContent>
    </Dialog>
  )
}
