import type { ChapterProgress } from './chapter-progress'

/**
 * chapter-close.md → Manual user-triggered close: the threshold met with auto-close off, so the
 * close waits on the user, and a reply to end on.
 */
export function isReadyToClose(
  progress: Pick<ChapterProgress, 'tokens' | 'threshold' | 'canClose'>,
  autoClose: boolean,
): boolean {
  return !autoClose && progress.tokens >= progress.threshold && progress.canClose
}
