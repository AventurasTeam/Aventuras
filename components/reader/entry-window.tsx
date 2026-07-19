// components/reader/entry-window.tsx
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ForwardedRef,
  type ReactNode,
  type UIEvent,
  type WheelEvent,
} from 'react'
import {
  FlatList,
  Platform,
  StyleSheet,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'

import { computePrependCompensation } from '@/lib/reader-scroll'

type EntryWindowProps<T extends { id: string }> = {
  rows: readonly T[]
  renderRow: (row: T) => ReactNode
  onNearTop: () => void
  onNearBottomChange: (isNearBottom: boolean) => void
  onScrollPositionChange: (pos: { distanceFromBottomPx: number }) => void
  /**
   * Explicit user scroll gesture: wheel-up on web, drag-begin on native.
   * Unlike scroll-position events, gestures can't be raced by programmatic
   * autoscroll pins — hosts use this to break the autoscroll pin loop.
   */
  onUserScrollGesture?: () => void
}

type EntryWindowHandle = {
  scrollToBottom: (opts?: { smooth?: boolean }) => void
}

const ESTIMATED_ROW_HEIGHT_PX = 120
const OVERSCAN = 6

// FlatList treats a threshold of 1 as "within one viewport of the edge",
// matching the web branch's one-clientHeight top boundary check below.
const EDGE_THRESHOLD_VIEWPORTS = 1
const NEAR_BOTTOM_THRESHOLD_PX = 20
const MAINTAIN_VISIBLE_CONTENT_POSITION = { minIndexForVisible: 0 } as const

const styles = StyleSheet.create({
  list: { flex: 1 },
  listLanding: { flex: 1, opacity: 0 },
})

function trackStyle(totalSizePx: number): CSSProperties {
  return { position: 'relative', width: '100%', height: totalSizePx }
}

function rowStyle(offsetPx: number): CSSProperties {
  return {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    transform: `translateY(${offsetPx}px)`,
  }
}

function EntryWindowWebInner<T extends { id: string }>(
  {
    rows,
    renderRow,
    onNearTop,
    onNearBottomChange,
    onScrollPositionChange,
    onUserScrollGesture,
  }: EntryWindowProps<T>,
  ref: ForwardedRef<EntryWindowHandle>,
) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT_PX,
    overscan: OVERSCAN,
    // Key by row identity, not index: prepending older entries shifts every
    // index, and identity keys keep measured heights attached to their rows so
    // getOffsetForIndex reports the true prepended-block height.
    getItemKey: (index) => rows[index]!.id,
  })

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: (opts) => {
        if (rows.length === 0) return
        virtualizer.scrollToIndex(rows.length - 1, {
          align: 'end',
          behavior: opts?.smooth ? 'smooth' : 'auto',
        })
      },
    }),
    [rows.length, virtualizer],
  )

  const prevFirstIdRef = useRef<string | undefined>(rows[0]?.id)

  // react-virtual's track height (getTotalSize) recomputes synchronously when
  // `count` grows, so the prepended block's height is already reflected in
  // this render's layout — only the scroll-position delta needs correcting,
  // not a temporary padding reservation (that's the non-virtualized recipe).
  useLayoutEffect(() => {
    const el = scrollRef.current
    const prevFirstId = prevFirstIdRef.current
    const nextFirstId = rows[0]?.id
    prevFirstIdRef.current = nextFirstId
    if (!el || prevFirstId == null || nextFirstId === prevFirstId) return

    const insertedCount = rows.findIndex((row) => row.id === prevFirstId)
    if (insertedCount <= 0) return

    const prependedBlockHeightPx = virtualizer.getOffsetForIndex(insertedCount, 'start')?.[0] ?? 0
    if (prependedBlockHeightPx <= 0) return

    const { scrollTopDeltaPx } = computePrependCompensation({ prependedBlockHeightPx })
    el.scrollTop += scrollTopDeltaPx
  }, [rows, virtualizer])

  // Land at the tail on first open: rows may be empty on first render, so fire
  // when they first arrive. The one-shot flag keeps this off the user's later
  // scrolling and the prepend anchor above; scrollToIndex self-reconciles to
  // the true bottom as estimated row heights get measured.
  const didInitialScrollRef = useRef(false)
  useLayoutEffect(() => {
    if (didInitialScrollRef.current || rows.length === 0) return
    didInitialScrollRef.current = true
    virtualizer.scrollToIndex(rows.length - 1, { align: 'end' })
  }, [rows, virtualizer])

  const nearTopRef = useRef(false)
  const nearBottomRef = useRef(false)
  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const { scrollTop, clientHeight, scrollHeight } = event.currentTarget
      const withinTop = scrollTop <= clientHeight
      const distanceFromBottomPx = scrollHeight - scrollTop - clientHeight
      const withinBottom = distanceFromBottomPx <= NEAR_BOTTOM_THRESHOLD_PX
      if (withinTop && !nearTopRef.current) onNearTop()
      nearTopRef.current = withinTop
      if (withinBottom !== nearBottomRef.current) onNearBottomChange(withinBottom)
      nearBottomRef.current = withinBottom
      onScrollPositionChange({ distanceFromBottomPx })
    },
    [onNearTop, onNearBottomChange, onScrollPositionChange],
  )

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      // Upward only: wheel-down toward the live edge should let the positional
      // rule re-engage autoscroll, not interrupt it.
      if (event.deltaY < 0) onUserScrollGesture?.()
    },
    [onUserScrollGesture],
  )

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto"
      onScroll={handleScroll}
      onWheel={handleWheel}
    >
      <div style={trackStyle(virtualizer.getTotalSize())}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            ref={virtualizer.measureElement}
            data-index={virtualRow.index}
            style={rowStyle(virtualRow.start)}
          >
            {renderRow(rows[virtualRow.index]!)}
          </div>
        ))}
      </div>
    </div>
  )
}
const EntryWindowWeb = forwardRef(EntryWindowWebInner) as <T extends { id: string }>(
  props: EntryWindowProps<T> & { ref?: ForwardedRef<EntryWindowHandle> },
) => ReturnType<typeof EntryWindowWebInner>

function EntryWindowNativeInner<T extends { id: string }>(
  {
    rows,
    renderRow,
    onNearTop,
    onNearBottomChange,
    onScrollPositionChange,
    onUserScrollGesture,
  }: EntryWindowProps<T>,
  ref: ForwardedRef<EntryWindowHandle>,
) {
  const listRef = useRef<FlatList<T>>(null)

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: (opts) => {
        listRef.current?.scrollToEnd({ animated: opts?.smooth ?? false })
      },
    }),
    [],
  )

  // The mount-time row count: rendering the whole hydrated window in the first
  // pass (instead of the default 10-row batches) turns open-at-end into a
  // single layout + single scrollToEnd instead of a visible batch-by-batch
  // crawl. Bounded by ENTRIES_WINDOW_SIZE upstream; later paging renders
  // through normal virtualization.
  const initialRenderCountRef = useRef(rows.length > 0 ? rows.length : undefined)

  // Land at the tail on first open — as a pin, not a one-shot: content can
  // still grow before the user's first gesture (late row measurement, a
  // streaming tail, rich-card underlay→WebView swaps), and all of it wants
  // bottom. The user's first drag breaks the pin, same as the host's
  // autoscroll pin. The list stays invisible until the first pin assertion has
  // taken effect, so the pre-scroll frame at the top never flashes.
  const initialPinRef = useRef(true)
  const [landed, setLanded] = useState(rows.length === 0)
  const handleContentSizeChange = useCallback(() => {
    if (!initialPinRef.current || rows.length === 0) return
    listRef.current?.scrollToEnd({ animated: false })
    requestAnimationFrame(() => setLanded(true))
  }, [rows.length])

  const handleScrollBeginDrag = useCallback(() => {
    initialPinRef.current = false
    onUserScrollGesture?.()
  }, [onUserScrollGesture])

  const nearBottomRef = useRef(false)
  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
      const distanceFromBottomPx = contentSize.height - contentOffset.y - layoutMeasurement.height
      const withinBottom = distanceFromBottomPx <= NEAR_BOTTOM_THRESHOLD_PX
      if (withinBottom !== nearBottomRef.current) onNearBottomChange(withinBottom)
      nearBottomRef.current = withinBottom
      onScrollPositionChange({ distanceFromBottomPx })
    },
    [onNearBottomChange, onScrollPositionChange],
  )

  return (
    <FlatList
      ref={listRef}
      data={rows}
      keyExtractor={(row) => row.id}
      renderItem={({ item }) => <>{renderRow(item)}</>}
      initialNumToRender={initialRenderCountRef.current}
      onContentSizeChange={handleContentSizeChange}
      onScroll={handleScroll}
      onScrollBeginDrag={handleScrollBeginDrag}
      scrollEventThrottle={100}
      maintainVisibleContentPosition={MAINTAIN_VISIBLE_CONTENT_POSITION}
      onStartReached={onNearTop}
      onStartReachedThreshold={EDGE_THRESHOLD_VIEWPORTS}
      style={landed ? styles.list : styles.listLanding}
    />
  )
}
const EntryWindowNative = forwardRef(EntryWindowNativeInner) as <T extends { id: string }>(
  props: EntryWindowProps<T> & { ref?: ForwardedRef<EntryWindowHandle> },
) => ReturnType<typeof EntryWindowNativeInner>

function EntryWindowInner<T extends { id: string }>(
  props: EntryWindowProps<T>,
  ref: ForwardedRef<EntryWindowHandle>,
) {
  return Platform.OS === 'web' ? (
    <EntryWindowWeb {...props} ref={ref} />
  ) : (
    <EntryWindowNative {...props} ref={ref} />
  )
}
const EntryWindow = forwardRef(EntryWindowInner) as <T extends { id: string }>(
  props: EntryWindowProps<T> & { ref?: ForwardedRef<EntryWindowHandle> },
) => ReturnType<typeof EntryWindowInner>

export { EntryWindow }
export type { EntryWindowHandle, EntryWindowProps }
