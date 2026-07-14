// components/reader/entry-window.tsx
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ForwardedRef,
  type ReactNode,
  type UIEvent,
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
}

type EntryWindowHandle = {
  scrollToBottom: (opts?: { smooth?: boolean }) => void
}

const ESTIMATED_ROW_HEIGHT_PX = 120
const OVERSCAN = 6

// FlatList treats a threshold of 1 as "within one viewport of the edge",
// matching the web branch's one-clientHeight boundary check below.
const EDGE_THRESHOLD_VIEWPORTS = 1
const MAINTAIN_VISIBLE_CONTENT_POSITION = { minIndexForVisible: 0 } as const

const styles = StyleSheet.create({
  list: { flex: 1 },
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
  { rows, renderRow, onNearTop, onNearBottomChange, onScrollPositionChange }: EntryWindowProps<T>,
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
      const withinBottom = distanceFromBottomPx <= clientHeight
      if (withinTop && !nearTopRef.current) onNearTop()
      nearTopRef.current = withinTop
      if (withinBottom !== nearBottomRef.current) onNearBottomChange(withinBottom)
      nearBottomRef.current = withinBottom
      onScrollPositionChange({ distanceFromBottomPx })
    },
    [onNearTop, onNearBottomChange, onScrollPositionChange],
  )

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto" onScroll={handleScroll}>
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
  { rows, renderRow, onNearTop, onNearBottomChange, onScrollPositionChange }: EntryWindowProps<T>,
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

  // Land at the tail on first open. onContentSizeChange fires once the initial
  // rows have laid out (firmer than a rows-keyed effect); the one-shot flag
  // keeps later size changes off the user's scrolling.
  const didInitialScrollRef = useRef(false)
  const handleContentSizeChange = useCallback(() => {
    if (didInitialScrollRef.current || rows.length === 0) return
    didInitialScrollRef.current = true
    listRef.current?.scrollToEnd({ animated: false })
  }, [rows.length])

  const nearBottomRef = useRef(false)
  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
      const distanceFromBottomPx = contentSize.height - contentOffset.y - layoutMeasurement.height
      const withinBottom = distanceFromBottomPx <= layoutMeasurement.height
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
      onContentSizeChange={handleContentSizeChange}
      onScroll={handleScroll}
      scrollEventThrottle={100}
      maintainVisibleContentPosition={MAINTAIN_VISIBLE_CONTENT_POSITION}
      onStartReached={onNearTop}
      onStartReachedThreshold={EDGE_THRESHOLD_VIEWPORTS}
      style={styles.list}
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
export type { EntryWindowProps, EntryWindowHandle }
