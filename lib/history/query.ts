import { and, asc, desc, eq, gt, inArray, lt, or, sql, type SQL } from 'drizzle-orm'

import { PAYLOAD_META_PREFIX } from '@/lib/actions'
import { deltas, type DbCtx, type Delta } from '@/lib/db'

import {
  HISTORY_OPS,
  linkLabelsMatching,
  opsMatchingLabel,
  pathsMatchingLabel,
  removalSummaryTerm,
  removalTargetLabel,
  summaryFieldTerms,
  type HistoryTable,
} from './field-labels'
import { inJsonList, loadLinkEnds, type LinkEnd, type LinkEnds } from './link-ends'
import type { HistoryLinkTable, HistoryRow, HistoryVia } from './link-rows'

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

export type HistoryChunk = {
  rows: HistoryRow[]
  nextCursor: number | null
  /** Every link end's name: live row first, else its latest delete payload. */
  names: Readonly<Record<string, string>>
}

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

/** A part of the union whose field paths read through one table's labels, from one side. */
type Scope = { member: SQL } & (
  | { table: 'character_relationships'; side: 'a' | 'b' }
  | { table: HistoryTable | Exclude<HistoryLinkTable, 'character_relationships'> }
)

function termPaths(scope: Scope, term: string): string[] {
  const paths = new Set(
    scope.table === 'character_relationships'
      ? pathsMatchingLabel(scope.table, term, scope.side)
      : pathsMatchingLabel(scope.table, term),
  )
  if (PATH_TERM.test(term)) paths.add(term)
  return [...paths]
}

// json_type, not json_extract — json_extract can't tell an absent path from a stored JSON null.
function pathPresent(path: string): SQL {
  return sql`json_type(${deltas.undoPayload}, ${`$.${path}`}) IS NOT NULL`
}

function linkMember(table: HistoryLinkTable, ids: readonly string[]): SQL {
  return and(eq(deltas.targetTable, table), inJsonList(deltas.targetId, ids)) as SQL
}

function removalMember(removals: LinkEnds['removals']): SQL {
  return inJsonList(
    deltas.id,
    removals.map((removal) => removal.deltaId),
  )
}

// A relationship's labels turn on the tab's side, so its link rows scope per side.
function linkScopes(ends: LinkEnds): Scope[] {
  const groups = new Map<string, { first: LinkEnd; ids: string[] }>()
  for (const link of ends.links) {
    const key = `${link.table}:${link.side}`
    const group = groups.get(key) ?? { first: link, ids: [] }
    group.ids.push(link.linkId)
    groups.set(key, group)
  }
  return [...groups.values()].map(({ first, ids }) => {
    const member = linkMember(first.table, ids)
    return first.table === 'character_relationships'
      ? { member, table: first.table, side: first.side }
      : { member, table: first.table }
  })
}

function linkMembers(links: LinkEnds['links']): SQL[] {
  const ids = new Map<HistoryLinkTable, string[]>()
  for (const link of links) ids.set(link.table, [...(ids.get(link.table) ?? []), link.linkId])
  return [...ids].map(([table, tableIds]) => linkMember(table, tableIds))
}

// world.md → History tab: a retrieval-count bump changes nothing the user wrote or sees.
const NOT_RETRIEVAL_BUMP = sql`NOT (${deltas.targetTable} = 'happening_awareness'
  AND ${deltas.op} = 'update'
  AND (SELECT count(*) FROM json_each(${deltas.undoPayload})) = 1
  AND json_type(${deltas.undoPayload}, '$.retrievalCount') IS NOT NULL)`

// op=update gate: a delete's payload is the full row, so every field would else match.
function fieldSearchCondition(scopes: readonly Scope[], term: string): SQL {
  const labelled = scopes.flatMap((scope) => {
    const paths = termPaths(scope, term)
    return paths.length === 0 ? [] : [and(scope.member, or(...paths.map(pathPresent))) as SQL]
  })
  return and(eq(deltas.op, 'update'), or(freeTextCondition(term), ...labelled)) as SQL
}

// A summary names fields, never values: each named field must resolve to a path the update changed.
function summarySearchCondition(scope: Scope, fields: readonly string[]): SQL {
  const perField = fields.map(
    (field) => or(...termPaths(scope, field).map(pathPresent)) ?? sql`false`,
  )
  return and(scope.member, eq(deltas.op, 'update'), ...perField) as SQL
}

function normalized(text: string): string {
  return text.trim().toLocaleLowerCase().split(/\s+/).join(' ')
}

// Word-start across spaces, so a multi-word name typed whole ("the keep") still matches.
function startsAWord(text: string, needle: string): boolean {
  return needle !== '' && ` ${normalized(text)}`.includes(` ${needle}`)
}

function namedEnds(ends: LinkEnds, term: string): ReadonlySet<string> {
  const needle = normalized(term)
  return new Set(Object.keys(ends.names).filter((id) => startsAWord(ends.names[id], needle)))
}

// world.md → History tab: a link row's target line is its link label and its other end's name.
function targetLineCondition(ends: LinkEnds, term: string): SQL | null {
  const tables = new Set(linkLabelsMatching(term))
  const needle = normalized(term)
  const named = namedEnds(ends, term)
  const removal = removalSummaryTerm(term)
  const removedNamed = removal?.kind === 'named' ? namedEnds(ends, removal.name) : new Set<string>()
  const links = ends.links.filter((link) => tables.has(link.table) || named.has(link.otherId))
  const removals = ends.removals.filter(
    (row) =>
      removal?.kind === 'any' ||
      (removal?.kind === 'unknown' && !Object.hasOwn(ends.names, row.otherId)) ||
      removedNamed.has(row.otherId) ||
      named.has(row.otherId) ||
      startsAWord(removalTargetLabel(row.tables), needle) ||
      row.tables.some((table) => tables.has(table)),
  )
  const conditions = [
    ...linkMembers(links),
    ...(removals.length > 0 ? [removalMember(removals)] : []),
  ]
  return conditions.length === 0 ? null : (or(...conditions) as SQL)
}

// world.md → History tab: term also matches an op via its rendered label (name/chip/summary).
function searchCondition(scopes: readonly Scope[], ends: LinkEnds, term: string): SQL {
  const ops = new Set(opsMatchingLabel(term))
  const lowered = term.toLowerCase()
  if ((HISTORY_OPS as readonly string[]).includes(lowered)) ops.add(lowered as Delta['op'])
  const conditions: SQL[] = [fieldSearchCondition(scopes, term)]
  if (ops.size > 0) conditions.push(inArray(deltas.op, [...ops]))
  const named = summaryFieldTerms(term)
  if (named != null) conditions.push(...scopes.map((scope) => summarySearchCondition(scope, named)))
  const targetLine = targetLineCondition(ends, term)
  if (targetLine != null) conditions.push(targetLine)
  return or(...conditions) as SQL
}

function viaOf(query: HistoryQuery, ends: LinkEnds): (delta: Delta) => HistoryVia {
  const links = new Map(ends.links.map((link) => [`${link.table}:${link.linkId}`, link]))
  const removals = new Map(ends.removals.map((removal) => [removal.deltaId, removal]))
  return (delta) => {
    if (delta.targetTable === query.targetTable && delta.targetId === query.targetId)
      return { kind: 'own' }
    const removal = removals.get(delta.id)
    if (removal != null)
      return { kind: 'removed', tables: removal.tables, otherId: removal.otherId }
    const link = links.get(`${delta.targetTable}:${delta.targetId}`)
    if (link != null) return { kind: 'link', ...link }
    throw new Error(`history: delta ${delta.id} matched the union but no part of it`)
  }
}

/** One chunk of a row's delta log and its link rows', paged in sort order. */
export async function loadHistoryChunk(
  db: DbCtx['db'],
  query: HistoryQuery,
): Promise<HistoryChunk> {
  const limit = query.limit ?? HISTORY_CHUNK_SIZE
  const ends = await loadLinkEnds(db, query.branchId, query.targetTable, query.targetId)
  const scopes: Scope[] = [
    {
      member: and(
        eq(deltas.targetTable, query.targetTable),
        eq(deltas.targetId, query.targetId),
      ) as SQL,
      table: query.targetTable,
    },
    ...linkScopes(ends),
  ]
  const union = scopes.map((scope) => scope.member)
  if (ends.removals.length > 0) union.push(removalMember(ends.removals))
  const where: SQL[] = [
    eq(deltas.branchId, query.branchId),
    or(...union) as SQL,
    NOT_RETRIEVAL_BUMP,
  ]
  if (query.op != null) where.push(eq(deltas.op, query.op))
  const term = query.search?.trim() ?? ''
  if (term !== '') where.push(searchCondition(scopes, ends, term))
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
  const via = viaOf(query, ends)
  return {
    rows: page.map((delta) => ({ delta, via: via(delta) })),
    nextCursor: rows.length > limit ? (page.at(-1)?.logPosition ?? null) : null,
    names: ends.names,
  }
}
