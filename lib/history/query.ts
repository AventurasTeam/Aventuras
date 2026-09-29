import { and, asc, desc, eq, gt, inArray, lt, or, sql, type SQL } from 'drizzle-orm'

import { PAYLOAD_META_PREFIX } from '@/lib/actions'
import { deltas, type DbCtx, type Delta } from '@/lib/db'

import {
  HISTORY_OPS,
  opsMatchingLabel,
  pathsMatchingLabel,
  summaryFieldTerms,
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

// The payload stores text JSON-escaped, so the term is escaped the same way before the LIKE
// escaping, which then also covers the backslashes the JSON escaping added.
function likePattern(term: string): string {
  const escaped = JSON.stringify(term).slice(1, -1)
  return `%${escaped.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

// Each member's `"key":value` text, skipping meta members: reversal facts, not columns.
function freeTextCondition(term: string): SQL {
  return sql`EXISTS (SELECT 1 FROM json_each(${deltas.undoPayload}) AS member
    WHERE substr(member.key, 1, ${PAYLOAD_META_PREFIX.length}) <> ${PAYLOAD_META_PREFIX}
      AND (json_quote(member.key) || ':' || (${deltas.undoPayload} -> member.fullkey))
        LIKE ${likePattern(term)} ESCAPE '\\')`
}

// json_type, not json_extract — json_extract can't tell an absent path from a stored JSON null.
function fieldSearchCondition(table: HistoryTable, term: string): SQL {
  const paths = new Set(pathsMatchingLabel(table, term))
  if (PATH_TERM.test(term)) paths.add(term)
  // op=update gate: a delete's payload is the full row, so every field would else match.
  return and(
    eq(deltas.op, 'update'),
    or(
      freeTextCondition(term),
      ...[...paths].map(
        (path) => sql`json_type(${deltas.undoPayload}, ${`$.${path}`}) IS NOT NULL`,
      ),
    ),
  ) as SQL
}

// world.md → History tab: term also matches an op via its rendered label (name/chip/summary).
function searchCondition(table: HistoryTable, term: string): SQL {
  const ops = new Set(opsMatchingLabel(term))
  const lowered = term.toLowerCase()
  if ((HISTORY_OPS as readonly string[]).includes(lowered)) ops.add(lowered as Delta['op'])
  const conditions: SQL[] = [fieldSearchCondition(table, term)]
  if (ops.size > 0) conditions.push(inArray(deltas.op, [...ops]))
  // A typed update summary: every field it names must match, each searched as if typed alone.
  const named = summaryFieldTerms(term)
  if (named != null)
    conditions.push(and(...named.map((field) => fieldSearchCondition(table, field))) as SQL)
  return or(...conditions) as SQL
}

/** One chunk of a row's delta log, paged in sort order (C4). */
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
