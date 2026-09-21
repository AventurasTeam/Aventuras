import { desc, eq, sql } from 'drizzle-orm'

import type { DbCtx } from '@/lib/actions'
import { storyEntries } from '@/lib/db'
import { excerpt } from '@/lib/text'

import type { EntryIndex, EntryRef } from './types'

const EXCERPT_SOURCE_CHARS = 200
export const ENTRY_EXCERPT_CHARS = 120

/**
 * Every entry of the branch, newest first. The entries store is a trailing window
 * (recent-window.ts), so anchors older than it need this read.
 */
export async function readEntryIndex(branchId: string, database: DbCtx['db']): Promise<EntryRef[]> {
  const rows = await database
    .select({
      id: storyEntries.id,
      position: storyEntries.position,
      kind: storyEntries.kind,
      chapterId: storyEntries.chapterId,
      head: sql<string>`substr(${storyEntries.content}, 1, ${EXCERPT_SOURCE_CHARS})`,
    })
    .from(storyEntries)
    .where(eq(storyEntries.branchId, branchId))
    .orderBy(desc(storyEntries.position))
  return rows.map((r) => ({
    id: r.id,
    position: r.position,
    kind: r.kind,
    chapterId: r.chapterId,
    excerpt: excerpt(r.head, ENTRY_EXCERPT_CHARS) ?? '',
  }))
}

export function indexEntryRefs(rows: readonly EntryRef[]): EntryIndex {
  return new Map(rows.map((r) => [r.id, r]))
}
