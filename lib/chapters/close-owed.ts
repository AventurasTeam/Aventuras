import type { ChapterProgress } from './chapter-progress'
import { thresholdMet } from './threshold-met'

/**
 * C10's owed close, in `closeOwed`'s order: a pending manual pick, else auto-close on with the
 * open region at the threshold and a reply to end on.
 */
export function isCloseOwed(
  progress: Pick<ChapterProgress, 'tokens' | 'threshold' | 'canClose'>,
  autoClose: boolean,
  manualPending: boolean,
): boolean {
  return manualPending || (autoClose && thresholdMet(progress))
}
