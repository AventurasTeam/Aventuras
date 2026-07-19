// lib/reader-scroll/scroll-metrics.ts
export type ScrollReading = {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

export type ScrollMetrics = {
  distanceFromBottomPx: number
  /** Within one viewport height of the loaded window's top — the auto-load boundary. */
  withinTopViewport: boolean
}

export function computeScrollMetrics(reading: ScrollReading): ScrollMetrics {
  const { scrollTop, clientHeight, scrollHeight } = reading
  return {
    distanceFromBottomPx: scrollHeight - scrollTop - clientHeight,
    withinTopViewport: scrollTop <= clientHeight,
  }
}
