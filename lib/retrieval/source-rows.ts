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

// Declared once and read by both the SELECT and the row mapper below, so the two
// cannot drift: reordering a column here moves it in the statement and in the
// read together, where two hand-aligned lists would land `name` in `description`
// with no error. Explicit, uniquely-named, non-numeric columns, because the
// drivers rebuild positional rows with Object.values (lib/db/runtime/exec.native.ts
// → queryRows) and a duplicate or numeric key silently collapses or reorders them.
const SOURCE_COLUMNS = {
  entity: ['id', 'kind', 'status', 'injection_mode', 'name', 'description', 'embedding_stale'],
  lore: ['id', 'title', 'body', 'injection_mode', 'priority', 'keywords', 'embedding_stale'],
  happening: [
    'id',
    'title',
    'description',
    'common_knowledge',
    'occurred_at_entry_id',
    'embedding_stale',
  ],
  thread: ['id', 'status', 'injection_mode', 'title', 'description', 'embedding_stale'],
  chapter: ['id', 'title', 'summary', 'theme', 'keywords', 'embedding_stale'],
} as const satisfies Record<VecTargetKind, readonly string[]>

type Cells<K extends VecTargetKind> = Record<(typeof SOURCE_COLUMNS)[K][number], unknown>

const SOURCE_SQL = Object.fromEntries(
  (Object.keys(SOURCE_COLUMNS) as VecTargetKind[]).map((kind) => [
    kind,
    `SELECT ${SOURCE_COLUMNS[kind].join(', ')} FROM ${SOURCE_TABLES[kind]} WHERE branch_id = ?`,
  ]),
) as Record<VecTargetKind, string>

function cellsOf<K extends VecTargetKind>(kind: K, row: unknown[]): Cells<K> {
  const out = {} as Cells<K>
  SOURCE_COLUMNS[kind].forEach((column, index) => {
    out[column as keyof Cells<K>] = row[index]
  })
  return out
}

// Coerced, not compared: a 0/1 that arrives as a bigint or a string would read
// as "not flagged" and silently disable the stale filter.
const flagged = (value: unknown): boolean => Number(value) === 1

export async function loadSourceRows(queryAll: QueryAll, branchId: string): Promise<SourceRows> {
  const read = (kind: VecTargetKind) => queryAll(SOURCE_SQL[kind], [branchId])

  // Five independent reads, one IPC round trip each on desktop. Issued together
  // and destructured in a fixed order so the mapping below stays deterministic.
  const [entityRows, loreRows, happeningRows, threadRows, chapterRows] = await Promise.all([
    read('entity'),
    read('lore'),
    read('happening'),
    read('thread'),
    read('chapter'),
  ])

  const entities = entityRows.map((row) => {
    const c = cellsOf('entity', row)
    return {
      id: c.id as string,
      kind: c.kind as EntityRow['kind'],
      status: c.status as EntityRow['status'],
      injectionMode: c.injection_mode as EntityRow['injectionMode'],
      name: c.name as string,
      description: c.description as string | null,
      embeddingStale: flagged(c.embedding_stale),
    }
  })

  const lore = loreRows.map((row) => {
    const c = cellsOf('lore', row)
    return {
      id: c.id as string,
      title: c.title as string,
      body: c.body as string | null,
      injectionMode: c.injection_mode as LoreRow['injectionMode'],
      priority: Number(c.priority),
      keywords: parseKeywords(c.keywords),
      embeddingStale: flagged(c.embedding_stale),
    }
  })

  const happenings = happeningRows.map((row) => {
    const c = cellsOf('happening', row)
    return {
      id: c.id as string,
      title: c.title as string,
      description: c.description as string | null,
      commonKnowledge: flagged(c.common_knowledge),
      occurredAtEntryId: c.occurred_at_entry_id as string | null,
      embeddingStale: flagged(c.embedding_stale),
    }
  })

  const threads = threadRows.map((row) => {
    const c = cellsOf('thread', row)
    return {
      id: c.id as string,
      status: c.status as ThreadRow['status'],
      injectionMode: c.injection_mode as ThreadRow['injectionMode'],
      title: c.title as string,
      description: c.description as string | null,
      embeddingStale: flagged(c.embedding_stale),
    }
  })

  const chapters = chapterRows.map((row) => {
    const c = cellsOf('chapter', row)
    return {
      id: c.id as string,
      title: c.title as string,
      summary: c.summary as string,
      theme: c.theme as string,
      keywords: parseKeywords(c.keywords),
      embeddingStale: flagged(c.embedding_stale),
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
