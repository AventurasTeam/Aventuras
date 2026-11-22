import { isCloseOwed } from './close-owed'

/** What follows a chapter delete (chapter-close.md → Deleting a chapter). */
export type ChapterDeleteAfter = 'closes-next-send' | 'waits' | 'stays-open'

/**
 * C13's after-delete line, in `closeOwed`'s order: a pending manual close first, then auto-close,
 * then the threshold. No reply check: the region after a delete always holds the end reply (C10).
 */
export function closeAfterDelete(args: {
  /** The open region's tokens once the chapter's entries rejoin it. */
  tokensAfter: number
  threshold: number
  autoClose: boolean
  /** `pendingClose.has(branchId)`: closeOwed owes it whatever the tokens. */
  manualPending: boolean
}): ChapterDeleteAfter {
  const progress = { tokens: args.tokensAfter, threshold: args.threshold, canClose: true }
  if (isCloseOwed(progress, args.autoClose, args.manualPending)) return 'closes-next-send'
  return args.autoClose ? 'waits' : 'stays-open'
}
