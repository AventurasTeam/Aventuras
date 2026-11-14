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
  if (args.manualPending) return 'closes-next-send'
  if (!args.autoClose) return 'stays-open'
  return args.tokensAfter >= args.threshold ? 'closes-next-send' : 'waits'
}
