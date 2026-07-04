import { useVirtualizer } from '@tanstack/react-virtual'
import {
  useCallback,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type UIEvent,
} from 'react'
import { FlatList, Platform, StyleSheet } from 'react-native'

import { computePrependCompensation } from '@/lib/reader-scroll'

type EntryWindowProps<T extends { id: string }> = {
  rows: readonly T[]
  renderRow: (row: T) => ReactNode
  onNearTop: () => void
  onNearBottom: () => void
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

function EntryWindowWeb<T extends { id: string }>({
  rows,
  renderRow,
  onNearTop,
  onNearBottom,
}: EntryWindowProps<T>) {
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

  const nearTopRef = useRef(false)
  const nearBottomRef = useRef(false)
  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const { scrollTop, clientHeight, scrollHeight } = event.currentTarget
      const withinTop = scrollTop <= clientHeight
      const withinBottom = scrollHeight - scrollTop - clientHeight <= clientHeight
      if (withinTop && !nearTopRef.current) onNearTop()
      nearTopRef.current = withinTop
      if (withinBottom && !nearBottomRef.current) onNearBottom()
      nearBottomRef.current = withinBottom
    },
    [onNearTop, onNearBottom],
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

function EntryWindowNative<T extends { id: string }>({
  rows,
  renderRow,
  onNearTop,
  onNearBottom,
}: EntryWindowProps<T>) {
  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.id}
      renderItem={({ item }) => <>{renderRow(item)}</>}
      maintainVisibleContentPosition={MAINTAIN_VISIBLE_CONTENT_POSITION}
      onStartReached={onNearTop}
      onStartReachedThreshold={EDGE_THRESHOLD_VIEWPORTS}
      onEndReached={onNearBottom}
      onEndReachedThreshold={EDGE_THRESHOLD_VIEWPORTS}
      style={styles.list}
    />
  )
}

function EntryWindow<T extends { id: string }>(props: EntryWindowProps<T>) {
  return Platform.OS === 'web' ? <EntryWindowWeb {...props} /> : <EntryWindowNative {...props} />
}

export { EntryWindow }
export type { EntryWindowProps }
