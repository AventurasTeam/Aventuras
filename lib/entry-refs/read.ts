import { and, desc, eq, ne, sql } from 'drizzle-orm'

import type { DbCtx } from '@/lib/db'
import { storyEntries } from '@/lib/db'
import { excerpt } from '@/lib/text'

import type { EntryIndex, EntryRef } from './types'

const EXCERPT_SOURCE_CHARS = 200
const ENTRY_EXCERPT_CHARS = 120

// Drops a trailing partial word so a forced ellipsis (below) follows a whole word. Only
// meaningful when the cut is known to have landed mid-word (see afterCut below) — a head
// already ending in whitespace has no partial word to drop.
function dropTrailingPartialWord(head: string): string {
  if (head === '' || /\s$/.test(head)) return head
  const lastBreak = head.search(/\s\S*$/)
  return lastBreak === -1 ? '' : head.slice(0, lastBreak)
}

/**
 * Every non-system entry of the branch, newest first. System entries are diagnostic,
 * carry no delta, and are hard-deleted (their position reused) at the next submit — nothing
 * may anchor to one. The entries store is a trailing window (recent-window.ts), so anchors
 * older than it need this read.
 */
export async function readEntryIndex(branchId: string, database: DbCtx['db']): Promise<EntryRef[]> {
  const rows = await database
    .select({
      id: storyEntries.id,
      position: storyEntries.position,
      kind: storyEntries.kind,
      chapterId: storyEntries.chapterId,
      head: sql<string>`substr(${storyEntries.content}, 1, ${EXCERPT_SOURCE_CHARS})`,
      // The character right after the cut: whitespace (or absent, past the end) means the
      // head's last word is whole; anything else means the cut landed mid-word.
      afterCut: sql<string>`substr(${storyEntries.content}, ${EXCERPT_SOURCE_CHARS + 1}, 1)`,
      truncated: sql<number>`length(${storyEntries.content}) > ${EXCERPT_SOURCE_CHARS}`,
    })
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), ne(storyEntries.kind, 'system')))
    .orderBy(desc(storyEntries.position))
  return rows.map((r) => {
    const truncated = Boolean(r.truncated)
    const cutMidWord = truncated && r.afterCut !== '' && !/\s/.test(r.afterCut)
    const head = cutMidWord ? dropTrailingPartialWord(r.head) : r.head
    const text = excerpt(head, ENTRY_EXCERPT_CHARS) ?? ''
    // The head is cut to EXCERPT_SOURCE_CHARS before excerpt() collapses whitespace, so a
    // short collapsed result doesn't mean the source was short — force the ellipsis excerpt()
    // had no way to know it owed.
    const needsEllipsis = truncated && text !== '' && !text.endsWith('…')
    return {
      id: r.id,
      position: r.position,
      kind: r.kind,
      chapterId: r.chapterId,
      excerpt: needsEllipsis ? `${text}…` : text,
    }
  })
}

export function indexEntryRefs(rows: readonly EntryRef[]): EntryIndex {
  return new Map(rows.map((r) => [r.id, r]))
}
