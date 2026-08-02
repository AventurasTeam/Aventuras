import { SOURCE_TABLES, type VecTargetKind } from '@/lib/db'

import { parseKeywords } from './name-index'
import type { EntityRow, LoreRow, ThreadRow } from './pools'
import type { QueryAll, RetrievalType } from './types'

export type Stale = { embeddingStale: boolean }

export type LoadedEntityRow = EntityRow & Stale
export type LoadedLoreRow = LoreRow & Stale & { keywords: string[] }
export type LoadedThreadRow = ThreadRow & Stale
export type LoadedHappeningRow = Stale & {
  id: string
  title: string
  description: string | null
  commonKnowledge: boolean
  occurredAtEntryId: string | null
}
export type LoadedChapterRow = Stale & {
  id: string
  title: string
  summary: string
  theme: string
  keywords: string[]
}

export type SourceRows = {
  entities: LoadedEntityRow[]
  lore: LoadedLoreRow[]
  happenings: LoadedHappeningRow[]
  threads: LoadedThreadRow[]
  chapters: LoadedChapterRow[]
}

// Every statement here obeys the QueryAll contract (lib/db/runtime/exec.native.ts
// → queryRows): explicit, uniquely-named, non-numeric columns, because the
// drivers rebuild positional rows with Object.values and a duplicate or numeric
// key silently collapses or reorders them.
const SOURCE_SQL: Record<VecTargetKind, string> = {
  entity: `SELECT id, kind, status, injection_mode, name, description, embedding_stale FROM ${SOURCE_TABLES.entity} WHERE branch_id = ?`,
  lore: `SELECT id, title, body, injection_mode, priority, keywords, embedding_stale FROM ${SOURCE_TABLES.lore} WHERE branch_id = ?`,
  happening: `SELECT id, title, description, common_knowledge, occurred_at_entry_id, embedding_stale FROM ${SOURCE_TABLES.happening} WHERE branch_id = ?`,
  thread: `SELECT id, status, injection_mode, title, description, embedding_stale FROM ${SOURCE_TABLES.thread} WHERE branch_id = ?`,
  chapter: `SELECT id, title, summary, theme, keywords, embedding_stale FROM ${SOURCE_TABLES.chapter} WHERE branch_id = ?`,
}

// Coerced, not compared: a 0/1 that arrives as a bigint or a string would read
// as "not flagged" and silently disable the stale filter.
const flagged = (value: unknown): boolean => Number(value) === 1

export async function loadSourceRows(queryAll: QueryAll, branchId: string): Promise<SourceRows> {
  const read = (kind: VecTargetKind) => queryAll(SOURCE_SQL[kind], [branchId])

  const entities = (await read('entity')).map((row) => {
    const [id, kind, status, injectionMode, name, description, stale] = row as [
      string,
      EntityRow['kind'],
      EntityRow['status'],
      EntityRow['injectionMode'],
      string,
      string | null,
      unknown,
    ]
    return { id, kind, status, injectionMode, name, description, embeddingStale: flagged(stale) }
  })

  const lore = (await read('lore')).map((row) => {
    const [id, title, body, injectionMode, priority, keywords, stale] = row as [
      string,
      string,
      string | null,
      LoreRow['injectionMode'],
      number,
      unknown,
      unknown,
    ]
    return {
      id,
      title,
      body,
      injectionMode,
      priority: Number(priority),
      keywords: parseKeywords(keywords),
      embeddingStale: flagged(stale),
    }
  })

  const happenings = (await read('happening')).map((row) => {
    const [id, title, description, commonKnowledge, occurredAtEntryId, stale] = row as [
      string,
      string,
      string | null,
      unknown,
      string | null,
      unknown,
    ]
    return {
      id,
      title,
      description,
      commonKnowledge: flagged(commonKnowledge),
      occurredAtEntryId,
      embeddingStale: flagged(stale),
    }
  })

  const threads = (await read('thread')).map((row) => {
    const [id, status, injectionMode, title, description, stale] = row as [
      string,
      ThreadRow['status'],
      ThreadRow['injectionMode'],
      string,
      string | null,
      unknown,
    ]
    return { id, status, injectionMode, title, description, embeddingStale: flagged(stale) }
  })

  const chapters = (await read('chapter')).map((row) => {
    const [id, title, summary, theme, keywords, stale] = row as [
      string,
      string,
      string,
      string,
      unknown,
      unknown,
    ]
    return {
      id,
      title,
      summary,
      theme,
      keywords: parseKeywords(keywords),
      embeddingStale: flagged(stale),
    }
  })

  return { entities, lore, happenings, threads, chapters }
}

export function staleCountsOf(sourceRows: SourceRows): Record<RetrievalType, number> {
  const count = (rows: readonly Stale[]): number => rows.filter((r) => r.embeddingStale).length
  return {
    entities: count(sourceRows.entities),
    lore: count(sourceRows.lore),
    happenings: count(sourceRows.happenings),
    threads: count(sourceRows.threads),
    chapters: count(sourceRows.chapters),
  }
}

/** Entry ids each closed chapter covers, for the chapter-match boost. */
export async function loadChapterRanges(
  queryAll: QueryAll,
  branchId: string,
): Promise<Map<string, Set<string>>> {
  const rows = await queryAll(
    // Aliased because both sides of the join name their key `id`: the drivers
    // rebuild positional rows with Object.values, and the duplicate key would
    // collapse the pair into a single entry-id cell.
    `SELECT c.id AS chapter_id, e.id AS entry_id FROM chapters c
     JOIN story_entries e ON e.branch_id = c.branch_id AND e.chapter_id = c.id
     WHERE c.branch_id = ?`,
    [branchId],
  )
  const out = new Map<string, Set<string>>()
  for (const [chapterId, entryId] of rows as [string, string][]) {
    const bucket = out.get(chapterId)
    if (bucket) bucket.add(entryId)
    else out.set(chapterId, new Set([entryId]))
  }
  return out
}
