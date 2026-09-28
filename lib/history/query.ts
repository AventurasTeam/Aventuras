import { and, asc, desc, eq, gt, lt, or, sql, type SQL } from 'drizzle-orm'

import { deltas, type DbCtx, type Delta } from '@/lib/db'

import type { HistoryTable } from './field-labels'

export type HistoryOp = Delta['op']
export type HistorySort = 'newest' | 'oldest'

export const HISTORY_CHUNK_SIZE = 50

export type HistoryQuery = {
  branchId: string
  targetTable: HistoryTable
  targetId: string
  op?: HistoryOp
  search?: string
  /** Paths whose translated label matches `search` (`pathsMatchingLabel`). */
  labelPaths?: readonly string[]
  sort: HistorySort
  /** The previous chunk's `nextCursor`; null for the first chunk. */
  cursor: number | null
  limit?: number
}

export type HistoryChunk = { rows: Delta[]; nextCursor: number | null }

const PATH_TERM = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/

function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

// docs/data-model.md → op=update encoding rule. json_type, not json_extract: a
// pre-change null sentinel reads as SQL NULL through json_extract either way (absent
// path or present-with-null), so a path the write set to null would never match.
function searchCondition(term: string, labelPaths: readonly string[]): SQL {
  const paths = new Set(labelPaths)
  if (PATH_TERM.test(term)) paths.add(term)
  return or(
    sql`${deltas.op} = ${term.toLowerCase()}`,
    sql`${deltas.undoPayload} LIKE ${likePattern(term)} ESCAPE '\\'`,
    ...[...paths].map((path) => sql`json_type(${deltas.undoPayload}, ${`$.${path}`}) IS NOT NULL`),
  ) as SQL
}

/** One load-older chunk of a row's delta log (C4). */
export async function loadHistoryChunk(
  db: DbCtx['db'],
  query: HistoryQuery,
): Promise<HistoryChunk> {
  const limit = query.limit ?? HISTORY_CHUNK_SIZE
  const where: SQL[] = [
    eq(deltas.branchId, query.branchId),
    eq(deltas.targetTable, query.targetTable),
    eq(deltas.targetId, query.targetId),
  ]
  if (query.op != null) where.push(eq(deltas.op, query.op))
  const term = query.search?.trim() ?? ''
  if (term !== '') where.push(searchCondition(term, query.labelPaths ?? []))
  if (query.cursor != null)
    where.push(
      query.sort === 'newest'
        ? lt(deltas.logPosition, query.cursor)
        : gt(deltas.logPosition, query.cursor),
    )
  const rows = (await db
    .select()
    .from(deltas)
    .where(and(...where))
    .orderBy(query.sort === 'newest' ? desc(deltas.logPosition) : asc(deltas.logPosition))
    .limit(limit + 1)) as Delta[]
  const page = rows.slice(0, limit)
  return { rows: page, nextCursor: rows.length > limit ? (page.at(-1)?.logPosition ?? null) : null }
}
