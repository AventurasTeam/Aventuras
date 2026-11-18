import type { ChapterProgress } from './chapter-progress'

/**
 * chapter-close.md → the open region at the threshold with a reply to end on: one test for the
 * auto close and the `Ready to close` label.
 */
export function thresholdMet(
  progress: Pick<ChapterProgress, 'tokens' | 'threshold' | 'canClose'>,
): boolean {
  return progress.tokens >= progress.threshold && progress.canClose
}
