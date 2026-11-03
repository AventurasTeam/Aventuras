/** A chapter's row exists only once it closes, so the open chapter is one past the highest. */
export function openChapterNumber(closed: readonly { sequenceNumber: number }[]): number {
  return closed.reduce((highest, chapter) => Math.max(highest, chapter.sequenceNumber), 0) + 1
}
