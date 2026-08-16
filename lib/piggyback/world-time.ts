import { MAX_WORLD_TIME_SECONDS } from '@/lib/calendar'
import { logger } from '@/lib/diagnostics'

// Takes the running total because both bounds are on the resulting worldTime,
// not on the delta: the reader's format walk is linear in the cumulative value.
export function resolvePiggybackWorldTimeDelta(
  delta: number,
  entryId: string,
  previousWorldTime: number,
): number {
  if (!Number.isFinite(delta) || delta < 0) {
    logger.warn('classifier.delta_clamped', { originalDelta: delta, finalDelta: 0, entryId })
    return 0
  }
  const headroom = Math.max(0, MAX_WORLD_TIME_SECONDS - previousWorldTime)
  if (delta > headroom) {
    logger.warn('classifier.delta_clamped', {
      originalDelta: delta,
      finalDelta: headroom,
      previousWorldTime,
      entryId,
    })
    return headroom
  }
  return delta
}
