import { and, asc, desc, eq, gt, inArray, lt, or, sql, type SQL } from 'drizzle-orm'

import { deltas, type DbCtx, type Delta } from '@/lib/db'

import {
  HISTORY_OPS,
  opsMatchingLabel,
  pathsMatchingLabel,
  type HistoryTable,
} from './field-labels'

export type HistoryOp = Delta['op']
export type HistorySort = 'newest' | 'oldest'

export const HISTORY_CHUNK_SIZE = 50

export type HistoryQuery = {
  branchId: string
  targetTable: HistoryTable
  targetId: string
  op?: HistoryOp
  search?: string
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

// json_type, not json_extract — json_extract can't tell an absent path from a stored JSON null.
function fieldSearchCondition(table: HistoryTable, term: string): SQL {
  const paths = new Set(pathsMatchingLabel(table, term))
  if (PATH_TERM.test(term)) paths.add(term)
  // op=update gate: a delete's payload is the full row, so every field would else match.
  return and(
    eq(deltas.op, 'update'),
    or(
      sql`${deltas.undoPayload} LIKE ${likePattern(term)} ESCAPE '\\'`,
      ...[...paths].map(
        (path) => sql`json_type(${deltas.undoPayload}, ${`$.${path}`}) IS NOT NULL`,
      ),
    ),
  ) as SQL
}

// world.md → scopeSummary: term also matches an op via its rendered label (name/chip/summary).
function searchCondition(table: HistoryTable, term: string): SQL {
  const ops = new Set(opsMatchingLabel(term))
  const lowered = term.toLowerCase()
  if ((HISTORY_OPS as readonly string[]).includes(lowered)) ops.add(lowered as Delta['op'])
  const conditions: SQL[] = [fieldSearchCondition(table, term)]
  if (ops.size > 0) conditions.push(inArray(deltas.op, [...ops]))
  return or(...conditions) as SQL
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
  if (term !== '') where.push(searchCondition(query.targetTable, term))
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
