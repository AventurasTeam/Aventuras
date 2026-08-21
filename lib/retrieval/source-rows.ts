import { BIND_CHUNK, SOURCE_TABLES, type VecTargetKind } from '@/lib/db'

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

/**
 * Happenings are deliberately absent. Entities, lore and threads need the whole
 * branch — the structural floor scans all three for `injection_mode='always'`,
 * the name index reads every entity name and lore keyword, and Layer-A
 * suppression needs every staged entity. Happenings need none of that, and
 * `retrieval.md → Scale assumptions` puts them in the thousands, so they load
 * by id once the pool is known (`loadHappeningRows`).
 */
export type SourceRows = {
  entities: LoadedEntityRow[]
  lore: LoadedLoreRow[]
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

  // Independent reads, one IPC round trip each on desktop. Issued together and
  // destructured in a fixed order so the mapping below stays deterministic.
  const [entityRows, loreRows, threadRows, chapterRows] = await Promise.all([
    read('entity'),
    read('lore'),
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

  return { entities, lore, threads, chapters }
}

/**
 * `happenings` arrives as a count rather than being derived from rows: the pass
 * never loads the whole happenings table, and this is a tripwire on the SYNC's
 * scope, so it has to see every row on the branch rather than the pool subset.
 */
export function staleCountsOf(
  sourceRows: SourceRows,
  happeningsStale: number,
): Record<RetrievalType, number> {
  const count = (rows: readonly Stale[]): number => rows.filter((r) => r.embeddingStale).length
  return {
    entities: count(sourceRows.entities),
    lore: count(sourceRows.lore),
    happenings: happeningsStale,
    threads: count(sourceRows.threads),
    chapters: count(sourceRows.chapters),
  }
}

/** Counted, not fetched: the tripwire wants a magnitude, not thousands of rows. */
export async function countStaleHappenings(queryAll: QueryAll, branchId: string): Promise<number> {
  const rows = await queryAll(
    `SELECT COUNT(*) FROM ${SOURCE_TABLES.happening} WHERE branch_id = ? AND embedding_stale = 1`,
    [branchId],
  )
  return Number(rows[0]?.[0] ?? 0)
}

export type HappeningScope = {
  /** Ids the KNN passes returned. */
  ids: readonly string[]
  /** Entry ids covered by the chapters that won budget — the chapter-match admission set. */
  entryIds: readonly string[]
}

/**
 * The happenings a single pass can actually use: its KNN hits plus everything
 * inside a seated chapter's range. Bounded by the pool rather than the branch,
 * which is the whole point — a `WHERE branch_id = ?` scan reads thousands of
 * rows across the IPC boundary to discard over 99% of them.
 */
export async function loadHappeningRows(
  queryAll: QueryAll,
  branchId: string,
  scope: HappeningScope,
): Promise<LoadedHappeningRow[]> {
  if (scope.ids.length === 0 && scope.entryIds.length === 0) return []

  const columns = SOURCE_COLUMNS.happening.join(', ')
  const statements: [string, unknown[]][] = []
  // Unchunked: the KNN cut caps this at three query vectors' worth of KNN_K.
  if (scope.ids.length > 0) {
    statements.push([
      `SELECT ${columns} FROM ${SOURCE_TABLES.happening} WHERE branch_id = ? AND id IN (${scope.ids.map(() => '?').join(', ')})`,
      [branchId, ...scope.ids],
    ])
  }
  // Chunked: a seated chapter's range grows with the chapter, under no pool-sized cap.
  for (let i = 0; i < scope.entryIds.length; i += BIND_CHUNK) {
    const entryIds = scope.entryIds.slice(i, i + BIND_CHUNK)
    statements.push([
      `SELECT ${columns} FROM ${SOURCE_TABLES.happening} WHERE branch_id = ? AND occurred_at_entry_id IN (${entryIds.map(() => '?').join(', ')})`,
      [branchId, ...entryIds],
    ])
  }
  // Two indexed seeks, not one OR: MULTI-INDEX OR needs ANALYZE stats this app never
  // builds and degrades to a full branch scan anyway. The dedupe below absorbs overlap.
  const raw = (await Promise.all(statements.map(([sql, params]) => queryAll(sql, params)))).flat()
  const mapped = raw.map((row) => {
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
  return [...new Map(mapped.map((r) => [r.id, r])).values()]
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
