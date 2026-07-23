import { logger } from '@/lib/diagnostics'

export function resolvePiggybackWorldTimeDelta(delta: number, entryId: string): number {
  if (delta >= 0) return delta
  logger.warn('classifier.delta_clamped', { originalDelta: delta, finalDelta: 0, entryId })
  return 0
}
