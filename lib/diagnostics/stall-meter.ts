const TICK_MS = 16

/**
 * Times a window on the JS thread. `longestGapMs` is the longest gap between consecutive records
 * (start, each 16 ms tick, stop), so a stall no tick interrupts still measures to the stop. Late
 * timer delivery (hidden-window throttling, Android UI-thread frame stalls) reads as a stall too.
 */
export function startStallMeter(): { stop: () => { wallMs: number; longestGapMs: number } } {
  const startedAt = Date.now()
  let last = startedAt
  let longestGapMs = 0
  const record = (): number => {
    const now = Date.now()
    longestGapMs = Math.max(longestGapMs, now - last)
    last = now
    return now
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
