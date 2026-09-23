import { and, desc, eq, ne, sql } from 'drizzle-orm'

import type { DbCtx } from '@/lib/db'
import { storyEntries } from '@/lib/db'
import { excerpt, stripMarkup } from '@/lib/text'

import type { EntryIndex, EntryRef } from './types'

const EXCERPT_SOURCE_CHARS = 200
const ENTRY_EXCERPT_CHARS = 120

// Drops a trailing partial word so the forced ellipsis follows a whole word. Only meaningful
// when the cut landed mid-word (see afterCut) — a head ending in whitespace has none to drop.
// A head with no earlier word (unspaced scripts) stays whole: a hard cut beats an empty excerpt.
function dropTrailingPartialWord(head: string): string {
  if (head === '' || /\s$/.test(head)) return head
  const lastBreak = head.search(/\s\S*$/)
  const kept = lastBreak === -1 ? '' : head.slice(0, lastBreak)
  return kept.trim() === '' ? head : kept
}

/**
 * Every non-system entry of the branch, newest first. System entries are deleted at the next
 * submit, so nothing may anchor to one. Bypasses the entries store's trailing window
 * (recent-window.ts) — older anchors still need this full read.
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
    const text = excerpt(stripMarkup(head), ENTRY_EXCERPT_CHARS) ?? ''
    // excerpt() collapses whitespace after the truncation cut, so a short result doesn't prove a
    // short source — force the ellipsis excerpt() has no way to know it owes.
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
