import { and, asc, desc, eq, inArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'

import {
  characterRelationships,
  deltas,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  type DbCtx,
} from '@/lib/db'

import { listedLinkColumns, type HistoryTable } from './field-labels'
import { HISTORY_LINK_TABLES, type HistoryLinkTable, type HistoryVia } from './link-rows'

// Omit per union member, so each arm keeps its table–side pairing.
type OmitEach<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** A link row naming the tab's row, shaped as its `HistoryVia` arm without `kind`. */
export type LinkEnd = OmitEach<Extract<HistoryVia, { kind: 'link' }>, 'kind'>

export type LinkEnds = {
  links: readonly LinkEnd[]
  removals: readonly {
    deltaId: string
    tables: Extract<HistoryVia, { kind: 'removed' }>['tables']
    otherId: string
  }[]
  /** Other ends' display names: live rows first, else their latest delete payload. */
  names: Readonly<Record<string, string>>
}

type Db = DbCtx['db']
type Removal = LinkEnds['removals'][number]
type Row = Record<string, unknown>

/** A link table and the tab's side in it, with the key naming the target and the other end's. */
type End = {
  link: OmitEach<LinkEnd, 'linkId' | 'otherId'>
  key: string
  otherKey: string
}

// Live rows and stored payloads both carry the rows' camelCase keys.
const ENDS: Record<HistoryTable, readonly End[]> = {
  entities: [
    { link: { table: 'character_relationships', side: 'a' }, key: 'aId', otherKey: 'bId' },
    { link: { table: 'character_relationships', side: 'b' }, key: 'bId', otherKey: 'aId' },
    {
      link: { table: 'happening_involvements', side: null },
      key: 'entityId',
      otherKey: 'happeningId',
    },
    {
      link: { table: 'happening_awareness', side: null },
      key: 'characterId',
      otherKey: 'happeningId',
    },
  ],
  happenings: [
    {
      link: { table: 'happening_involvements', side: null },
      key: 'happeningId',
      otherKey: 'entityId',
    },
    {
      link: { table: 'happening_awareness', side: null },
      key: 'happeningId',
      otherKey: 'characterId',
    },
  ],
  lore: [],
  threads: [],
}

/** In one link table, the columns naming a tab's row and those whose change lists a delta. */
export type HistoryLinkWatch = { keys: readonly string[]; listed: readonly string[] }

function watchOf(ends: readonly End[]): Partial<Record<HistoryLinkTable, HistoryLinkWatch>> {
  const watch: Partial<Record<HistoryLinkTable, { keys: string[]; listed: string[] }>> = {}
  for (const { link, key } of ends) {
    const entry = watch[link.table]
    if (entry == null) watch[link.table] = { keys: [key], listed: listedLinkColumns(link.table) }
    else entry.keys.push(key)
  }
  return watch
}

/** Per tab table, what its History watches in each link table naming its row. */
export const HISTORY_LINK_WATCH: Readonly<
  Record<HistoryTable, Partial<Record<HistoryLinkTable, HistoryLinkWatch>>>
> = {
  entities: watchOf(ENDS.entities),
  happenings: watchOf(ENDS.happenings),
  lore: watchOf(ENDS.lore),
  threads: watchOf(ENDS.threads),
}

// Where a delete's payload holds its cascade-removed link rows (delete-cascade.ts → PAYLOAD_KEY).
const HELD_KEY: Record<HistoryLinkTable, string> = {
  character_relationships: 'relationships',
  happening_involvements: 'involvements',
  happening_awareness: 'awareness',
}

const HOLDING_TABLES = ['entities', 'happenings']

/**
 * `column IN (ids)`, bound as one JSON array: the union binds every unbounded id list in one
 * statement, which `chunked` can't split under the bind cap (lib/db/bind-limit.ts).
 */
export function inJsonList(column: SQLWrapper, ids: readonly string[]): SQL {
  return sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`
}

function isLinkTable(table: string): table is HistoryLinkTable {
  return (HISTORY_LINK_TABLES as readonly string[]).includes(table)
}

function isRow(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmpty<T>(items: T[]): items is [T, ...T[]] {
  return items.length > 0
}

function linkOf(
  table: HistoryLinkTable,
  row: Row,
  ends: readonly End[],
  targetId: string,
): LinkEnd | null {
  const end = ends.find(
    (candidate) => candidate.link.table === table && row[candidate.key] === targetId,
  )
  if (end == null) return null
  const linkId = row.id
  const otherId = row[end.otherKey]
  return typeof linkId === 'string' && typeof otherId === 'string'
    ? { ...end.link, linkId, otherId }
    : null
}

async function liveRows(
  db: Db,
  branchId: string,
  targetTable: HistoryTable,
  targetId: string,
): Promise<{ table: HistoryLinkTable; rows: Row[] }[]> {
  if (targetTable === 'entities') {
    const [relationships, involvements, awareness] = await Promise.all([
      db
        .select()
        .from(characterRelationships)
        .where(
          and(
            eq(characterRelationships.branchId, branchId),
            or(eq(characterRelationships.aId, targetId), eq(characterRelationships.bId, targetId)),
          ),
        ),
      db
        .select()
        .from(happeningInvolvements)
        .where(
          and(
            eq(happeningInvolvements.branchId, branchId),
            eq(happeningInvolvements.entityId, targetId),
          ),
        ),
      db
        .select()
        .from(happeningAwareness)
        .where(
          and(
            eq(happeningAwareness.branchId, branchId),
            eq(happeningAwareness.characterId, targetId),
          ),
        ),
    ])
    return [
      { table: 'character_relationships', rows: relationships },
      { table: 'happening_involvements', rows: involvements },
      { table: 'happening_awareness', rows: awareness },
    ]
  }
  if (targetTable === 'happenings') {
    const [involvements, awareness] = await Promise.all([
      db
        .select()
        .from(happeningInvolvements)
        .where(
          and(
            eq(happeningInvolvements.branchId, branchId),
            eq(happeningInvolvements.happeningId, targetId),
          ),
        ),
      db
        .select()
        .from(happeningAwareness)
        .where(
          and(
            eq(happeningAwareness.branchId, branchId),
            eq(happeningAwareness.happeningId, targetId),
          ),
        ),
    ])
    return [
      { table: 'happening_involvements', rows: involvements },
      { table: 'happening_awareness', rows: awareness },
    ]
  }
  return []
}

// A link row deleted on its own names both ends in its payload; one a cascade removed rides in
// the deleting row's payload under HELD_KEY.
function namingTarget(ends: readonly End[], targetId: string): SQL {
  return or(
    ...ends.map((end) =>
      and(
        eq(deltas.targetTable, end.link.table),
        sql`json_extract(${deltas.undoPayload}, ${`$.${end.key}`}) = ${targetId}`,
      ),
    ),
    ...ends.map((end) =>
      and(
        inArray(deltas.targetTable, HOLDING_TABLES),
        sql`EXISTS (SELECT 1 FROM json_each(${deltas.undoPayload}, ${`$.${HELD_KEY[end.link.table]}`}) AS held
          WHERE json_extract(held.value, ${`$.${end.key}`}) = ${targetId})`,
      ),
    ),
  ) as SQL
}

function heldLinks(payload: Row, ends: readonly End[], targetId: string): LinkEnd[] {
  return HISTORY_LINK_TABLES.flatMap((table) => {
    const rows = payload[HELD_KEY[table]]
    if (!Array.isArray(rows)) return []
    return rows.flatMap((row) => {
      const link = isRow(row) ? linkOf(table, row, ends, targetId) : null
      return link == null ? [] : [link]
    })
  })
}

// An entity's delete payload holds its name, a happening's its title.
const PAYLOAD_NAME = sql<string | null>`coalesce(
  json_extract(${deltas.undoPayload}, '$.name'),
  json_extract(${deltas.undoPayload}, '$.title'))`

async function namesOf(
  db: Db,
  branchId: string,
  ids: readonly string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {}
  const names = new Map<string, string>()
  const [liveEntities, liveHappenings] = await Promise.all([
    db
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .where(and(eq(entities.branchId, branchId), inJsonList(entities.id, ids))),
    db
      .select({ id: happenings.id, name: happenings.title })
      .from(happenings)
      .where(and(eq(happenings.branchId, branchId), inJsonList(happenings.id, ids))),
  ])
  for (const row of [...liveEntities, ...liveHappenings]) names.set(row.id, row.name)
  const missing = ids.filter((id) => !names.has(id))
  if (missing.length > 0) {
    const deleted = await db
      .select({ id: deltas.targetId, name: PAYLOAD_NAME })
      .from(deltas)
      .where(
        and(
          eq(deltas.branchId, branchId),
          eq(deltas.op, 'delete'),
          inArray(deltas.targetTable, HOLDING_TABLES),
          inJsonList(deltas.targetId, missing),
        ),
      )
      .orderBy(desc(deltas.logPosition))
    for (const row of deleted)
      if (row.name != null && !names.has(row.id)) names.set(row.id, row.name)
  }
  return Object.fromEntries(names)
}

/** A tab's link ends without the other ends' names: the part that scans the branch's deletes. */
export type LinkEndScan = Pick<LinkEnds, 'links' | 'removals'>

export type ScanLinkEnds = (
  db: Db,
  branchId: string,
  targetTable: HistoryTable,
  targetId: string,
) => Promise<LinkEndScan>

const scanLinkEnds: ScanLinkEnds = async (db, branchId, targetTable, targetId) => {
  const ends = ENDS[targetTable]
  if (ends.length === 0) return { links: [], removals: [] }
  const [live, deletes] = await Promise.all([
    liveRows(db, branchId, targetTable, targetId),
    db
      .select({
        id: deltas.id,
        targetTable: deltas.targetTable,
        targetId: deltas.targetId,
        undoPayload: deltas.undoPayload,
      })
      .from(deltas)
      .where(
        and(eq(deltas.branchId, branchId), eq(deltas.op, 'delete'), namingTarget(ends, targetId)),
      )
      .orderBy(asc(deltas.logPosition)),
  ])
  const links: LinkEnd[] = []
  for (const { table, rows } of live) {
    for (const row of rows) {
      const link = linkOf(table, row, ends, targetId)
      if (link != null) links.push(link)
    }
  }
  const removals: Removal[] = []
  for (const removed of deletes) {
    const payload = removed.undoPayload ?? {}
    if (isLinkTable(removed.targetTable)) {
      const link = linkOf(removed.targetTable, payload, ends, targetId)
      if (link != null) links.push(link)
      continue
    }
    const held = heldLinks(payload, ends, targetId)
    links.push(...held)
    const tables = HISTORY_LINK_TABLES.filter((table) => held.some((link) => link.table === table))
    // The row's own delete is an own delta; the links it holds still name the row.
    const own = removed.targetTable === targetTable && removed.targetId === targetId
    if (isNonEmpty(tables) && !own)
      removals.push({ deltaId: removed.id, tables, otherId: removed.targetId })
  }
  return { links, removals }
}

/**
 * One scan per target until the memo is dropped. Its holder drops it on every History refresh
 * trigger: a sweep rewrites a delete's payload in place, so no DB token says when it went stale.
 */
export function memoizedLinkEndScan(): ScanLinkEnds {
  const scans = new Map<string, Promise<LinkEndScan>>()
  return (db, branchId, targetTable, targetId) => {
    const key = JSON.stringify([branchId, targetTable, targetId])
    const kept = scans.get(key)
    if (kept != null) return kept
    const scan = scanLinkEnds(db, branchId, targetTable, targetId)
    scans.set(key, scan)
    // Not kept when it fails, so a Retry scans again.
    scan.catch(() => {
      if (scans.get(key) === scan) scans.delete(key)
    })
    return scan
  }
}

/**
 * Link rows naming a History tab's row, live or in a delete's payload (world.md → History tab).
 * Names are read on every call, so a rename between refreshes still matches a search.
 */
export async function loadLinkEnds(
  db: Db,
  branchId: string,
  targetTable: HistoryTable,
  targetId: string,
  scan: ScanLinkEnds = scanLinkEnds,
): Promise<LinkEnds> {
  const { links, removals } = await scan(db, branchId, targetTable, targetId)
  const otherIds = [...new Set([...links, ...removals].map((end) => end.otherId))]
  return { links, removals, names: await namesOf(db, branchId, otherIds) }
}
