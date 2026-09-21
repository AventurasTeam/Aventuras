import { and, desc, eq, ne, sql } from 'drizzle-orm'

import type { DbCtx } from '@/lib/db'
import { storyEntries } from '@/lib/db'
import { excerpt } from '@/lib/text'

import type { EntryIndex, EntryRef } from './types'

const EXCERPT_SOURCE_CHARS = 200
const ENTRY_EXCERPT_CHARS = 120

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
      truncated: sql<number>`length(${storyEntries.content}) > ${EXCERPT_SOURCE_CHARS}`,
    })
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), ne(storyEntries.kind, 'system')))
    .orderBy(desc(storyEntries.position))
  return rows.map((r) => {
    const text = excerpt(r.head, ENTRY_EXCERPT_CHARS) ?? ''
    // The head is cut to EXCERPT_SOURCE_CHARS before excerpt() collapses whitespace, so a
    // short collapsed result doesn't mean the source was short — force the ellipsis excerpt()
    // had no way to know it owed.
    const needsEllipsis = Boolean(r.truncated) && text !== '' && !text.endsWith('…')
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
