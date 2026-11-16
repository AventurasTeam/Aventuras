// lib/reader-scroll/scroll-metrics.ts
export type ScrollReading = {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

export type ScrollMetrics = {
  distanceFromBottomPx: number
  /** Within one viewport height of the slice's top: the upward extension's boundary. */
  withinTopViewport: boolean
  /** Within one viewport height of the slice's bottom: the downward extension's boundary. */
  withinBottomViewport: boolean
}

export function computeScrollMetrics(reading: ScrollReading): ScrollMetrics {
  const { scrollTop, clientHeight, scrollHeight } = reading
  const distanceFromBottomPx = scrollHeight - scrollTop - clientHeight
  return {
    distanceFromBottomPx,
    withinTopViewport: scrollTop <= clientHeight,
    withinBottomViewport: distanceFromBottomPx <= clientHeight,
  }
}
