import { and, eq, inArray } from 'drizzle-orm'

import {
  chunked,
  translations,
  type CharacterRelationship,
  type EntityId,
  type EntityState,
  type HappeningAwareness,
  type HappeningInvolvement,
  type Translation,
} from '@/lib/db'

import type { DbCtx } from '../types'
import { createdKey, resolveByTable, type GroupScope, type HandlerOutcome } from './registry'

/** Tables a row can name: the link tables' ends, and every translation target. */
export type RefTable =
  | 'entities'
  | 'happenings'
  | 'lore'
  | 'threads'
  | 'story_entries'
  | 'character_relationships'
  | 'chapters'

export type LiveRef = { table: RefTable; id: string }

/** A column of `Row` naming a `refTable` row; `when` limits it to one translation target kind. */
type RefColumnOf<Row> = {
  readonly column: keyof Row & string
  readonly path?: never
  readonly refTable: RefTable
  readonly when?: { readonly column: keyof Row & string; readonly value: Translation['targetKind'] }
}

// Distributes over the kinds' state shapes. EntityId aliases string: any nullable string field.
type IdField<S> = S extends unknown
  ? {
      [K in keyof S]-?: [S[K], EntityId | null] extends [EntityId | null, S[K]] ? K : never
    }[keyof S]
  : never

/** A field of an entity's `state` naming a `refTable` row; unlike a link row's end, it can change. */
export type RefPath = {
  readonly column: 'state'
  readonly path: IdField<EntityState>
  readonly refTable: 'entities'
  readonly when?: never
}

type RefsByTable = {
  happening_involvements: RefColumnOf<HappeningInvolvement>
  happening_awareness: RefColumnOf<HappeningAwareness>
  character_relationships: RefColumnOf<CharacterRelationship>
  translations: RefColumnOf<Translation>
  entities: RefPath
}

/** Tables whose rows name other rows. */
export type ReferringTable = keyof RefsByTable

export type RefColumn = RefsByTable[ReferringTable]

export const TRANSLATION_TARGET_TABLE = {
  entity: 'entities',
  lore: 'lore',
  thread: 'threads',
  happening: 'happenings',
  story_entry: 'story_entries',
  character_relationship: 'character_relationships',
  chapter: 'chapters',
} as const satisfies Record<Translation['targetKind'], RefTable>

/**
 * The one reference registry, keyed by the referring table's registered name
 * (generation-pipeline.md → Reverse-replay).
 */
export const REF_COLUMNS: { readonly [T in ReferringTable]: readonly RefsByTable[T][] } = {
  happening_involvements: [
    { column: 'happeningId', refTable: 'happenings' },
    { column: 'entityId', refTable: 'entities' },
  ],
  happening_awareness: [
    { column: 'happeningId', refTable: 'happenings' },
    { column: 'characterId', refTable: 'entities' },
  ],
  character_relationships: [
    { column: 'aId', refTable: 'entities' },
    { column: 'bId', refTable: 'entities' },
  ],
  translations: translations.targetKind.enumValues.map((kind) => ({
    column: 'targetId',
    refTable: TRANSLATION_TARGET_TABLE[kind],
    when: { column: 'targetKind', value: kind },
  })),
  entities: [
    { column: 'state', path: 'parent_location_id', refTable: 'entities' },
    { column: 'state', path: 'faction_id', refTable: 'entities' },
  ],
}

// The annotation above closes REF_COLUMNS' keys, so its entries are exactly these.
const REFERRING = Object.entries(REF_COLUMNS) as [ReferringTable, readonly RefColumn[]][]

const isReferringTable = (table: string): table is ReferringTable =>
  Object.hasOwn(REF_COLUMNS, table)

const REF_TABLES: ReadonlySet<string> = new Set(
  REFERRING.flatMap(([, refs]) => refs.map((ref) => ref.refTable)),
)

/** Whether some REF_COLUMNS entry can name a row of `table`. */
export function isRefTable(table: string): table is RefTable {
  return REF_TABLES.has(table)
}

function refsOf(table: string): readonly RefColumn[] {
  return isReferringTable(table) ? REF_COLUMNS[table] : []
}

export function isPathRef(ref: RefColumn): ref is RefPath {
  return ref.path !== undefined
}

/** The JSON-path references a row of `table` can hold. */
export function pathRefsOf(table: string): readonly RefPath[] {
  return refsOf(table).filter(isPathRef)
}

function refValue(ref: RefColumn, row: Readonly<Record<string, unknown>>): unknown {
  const value = row[ref.column]
  if (ref.path === undefined) return value
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[ref.path]
    : undefined
}

function namedBy(refs: readonly RefColumn[], row: Readonly<Record<string, unknown>>): LiveRef[] {
  return refs.flatMap((ref) => {
    if (ref.when && row[ref.when.column] !== ref.when.value) return []
    const id = refValue(ref, row)
    return typeof id === 'string' ? [{ table: ref.refTable, id }] : []
  })
}

/** The rows `row` of `table` names; none if the table names nothing or the row lacks columns. */
export function rowRefs(table: string, row: Readonly<Record<string, unknown>>): LiveRef[] {
  return namedBy(refsOf(table), row)
}

/** The rows `row` of `table` names through a link-row column, never through a JSON path. */
export function columnRefs(table: string, row: Readonly<Record<string, unknown>>): LiveRef[] {
  return namedBy(
    refsOf(table).filter((ref) => !isPathRef(ref)),
    row,
  )
}

/** Each JSON-path reference of `row`, with the id it holds or null. */
export function pathRefIds(
  table: string,
  row: Readonly<Record<string, unknown>>,
): { ref: RefPath; id: string | null }[] {
  return pathRefsOf(table).map((ref) => {
    const id = refValue(ref, row)
    return { ref, id: typeof id === 'string' ? id : null }
  })
}

const REFERRERS = new Map<RefTable, { table: ReferringTable; ref: RefColumn }[]>()
for (const [table, refs] of REFERRING) {
  for (const ref of refs) {
    const referrers = REFERRERS.get(ref.refTable) ?? []
    referrers.push({ table, ref })
    REFERRERS.set(ref.refTable, referrers)
  }
}

/** Every referring table and column that can name a row of `refTable`. */
export function referrersOf(
  refTable: RefTable,
): readonly { table: ReferringTable; ref: RefColumn }[] {
  return REFERRERS.get(refTable) ?? []
}

async function exists(ctx: DbCtx, branchId: string, ref: LiveRef): Promise<boolean> {
  const entry = resolveByTable(ref.table)
  if (!entry) throw new Error(`missingRef: ${ref.table} is not a registered table`)
  const { table, idCol, branchCol } = entry.descriptor
  const [row] = await ctx.db
    .select({ id: idCol })
    .from(table)
    .where(branchCol ? and(eq(branchCol, branchId), eq(idCol, ref.id)) : eq(idCol, ref.id))
    .limit(1)
  return row != null
}

/** The refs among `refs` with no row on the branch, as `createdKey`s. */
export async function absentRefs(
  ctx: DbCtx,
  branchId: string,
  refs: readonly LiveRef[],
): Promise<Set<string>> {
  const byTable = new Map<RefTable, Set<string>>()
  for (const { table, id } of refs) {
    const ids = byTable.get(table) ?? new Set<string>()
    ids.add(id)
    byTable.set(table, ids)
  }
  const absent = new Set<string>()
  for (const [table, ids] of byTable) {
    const entry = resolveByTable(table)
    if (!entry) throw new Error(`absentRefs: ${table} is not a registered table`)
    const { table: target, idCol, branchCol } = entry.descriptor
    const present = new Set<unknown>()
    for (const chunk of chunked([...ids])) {
      const rows = await ctx.db
        .select({ id: idCol })
        .from(target)
        .where(
          branchCol ? and(eq(branchCol, branchId), inArray(idCol, chunk)) : inArray(idCol, chunk),
        )
      for (const { id } of rows) present.add(id)
    }
    for (const id of ids) if (!present.has(id)) absent.add(createdKey(table, id))
  }
  return absent
}

/**
 * FK-less tables take a dead id (cadence.md → User edits and classifier writes); group-created
 * rows count.
 */
export async function missingRef(
  ctx: DbCtx,
  branchId: string,
  refs: readonly LiveRef[],
  group?: GroupScope,
): Promise<boolean> {
  for (const ref of refs) {
    if (group?.created.has(createdKey(ref.table, ref.id))) continue
    if (!(await exists(ctx, branchId, ref))) return true
  }
  return false
}

export const MISSING_REF = {
  status: 'rejected',
  reason: 'the link names a row that no longer exists',
  code: 'noop',
} as const satisfies Extract<HandlerOutcome, { status: 'rejected' }>
