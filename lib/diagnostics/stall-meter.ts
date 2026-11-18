const TICK_MS = 16

/**
 * Times a window on the JS thread. `longestGapMs` is the longest gap between consecutive records
 * (start, each 16 ms tick, stop), so a stall no tick interrupts still measures to the stop. Late
 * timer delivery (hidden-window throttling, Android UI-thread frame stalls) reads as a stall too.
 * `now` must be monotonic and measure elapsed time unaffected by system-clock adjustments, so a
 * clock change mid-window reads as neither a stall nor negative time.
 */
export function startStallMeter(now: () => number = () => performance.now()): {
  stop: () => { wallMs: number; longestGapMs: number }
} {
  const startedAt = now()
  let last = startedAt
  let longestGapMs = 0
  const record = (): number => {
    const at = now()
    longestGapMs = Math.max(longestGapMs, at - last)
    last = at
    return at
  }
  const ticks = setInterval(record, TICK_MS)
  return {
    stop: () => {
      clearInterval(ticks)
      const stoppedAt = record()
      return { wallMs: stoppedAt - startedAt, longestGapMs }
    },
  }
}
