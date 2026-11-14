import {
  CLOSE_TOP_LEVEL_VALUE,
  type CloseReport,
  type CloseReportCall,
  type Delta,
  type Entity,
  type ThreadStatus,
} from '@/lib/db'
import { formatEntryRef } from '@/lib/entry-refs'
import { t } from '@/lib/i18n'
import { isJsonObject } from '@/lib/json-object'

import {
  CLOSE_REVIEW_AREAS,
  type CloseReview,
  type CloseReviewArea,
  type CloseReviewChange,
  type CloseReviewLookup,
  type CloseReviewRowRef,
  type CloseReviewTarget,
} from './close-review-types'
import { fieldPathLabel, HISTORY_TABLES, linkTableLabel, type HistoryTable } from './field-labels'
import { changedPaths } from './humanize'

type ReportRow = CloseReportCall['rows'][number]
type LabelledTable = HistoryTable | 'happening_involvements' | 'happening_awareness'

export const CREATE_LORE_TOOL = 'create_lore'
const VALUE_ARROW = ' → '

const LABELLED_TABLES: ReadonlySet<string> = new Set<LabelledTable>([
  ...HISTORY_TABLES,
  'happening_involvements',
  'happening_awareness',
])

const isLabelledTable = (table: string): table is LabelledTable => LABELLED_TABLES.has(table)

const AREA_BY_TABLE: ReadonlyMap<string, CloseReviewArea> = new Map([
  ['lore', 'lore'],
  ['threads', 'threads'],
  ['happenings', 'happenings'],
  ['happening_awareness', 'awareness'],
])

export const sameRow = (a: CloseReviewRowRef, b: CloseReviewRowRef): boolean =>
  a.table === b.table && a.id === b.id

/** C4: a call's landed paths, the keys of `values` less its `skippedFields`. */
export function landedPaths(call: CloseReportCall): string[] {
  const lost = new Set((call.skippedFields ?? []).map(({ field }) => field))
  return Object.keys(call.values ?? {}).filter((path) => !lost.has(path))
}

/** A report row as the review names it: the report's name, else the live row's, else its table's. */
export function reviewTarget(row: ReportRow, lookup: CloseReviewLookup): CloseReviewTarget {
  const name =
    row.name !== ''
      ? row.name
      : (lookup.nameOf(row.id) ??
        (row.table === 'happening_awareness'
          ? linkTableLabel('happening_awareness')
          : t('history:unknownTarget')))
  return { table: row.table, id: row.id, name }
}

type HappeningLinkTable = 'happening_involvements' | 'happening_awareness'

// A link create names only its character: the link itself is what the merge didn't carry over.
const LINK_CREATE_PATHS: ReadonlyMap<string, HappeningLinkTable> = new Map([
  ['entityId', 'happening_involvements'],
  ['characterId', 'happening_awareness'],
])

// A happening merge records its link rows' losses on keep, under the link tables' own paths.
function happeningLinkLabel(path: string): string | undefined {
  const created = LINK_CREATE_PATHS.get(path)
  if (created !== undefined) return linkTableLabel(created)
  for (const table of ['happening_awareness', 'happening_involvements'] as const) {
    const label = fieldPathLabel(table, path)
    if (label !== path) return label
  }
  return undefined
}

/** A delta path's name on its table, as History labels it; the path itself on another table. */
export function reviewFieldLabel(table: string, path: string): string {
  if (!isLabelledTable(table)) return path
  const label = fieldPathLabel(table, path)
  if (label !== path || table !== 'happenings') return label
  return happeningLinkLabel(path) ?? path
}

export function reviewRowKey(callIndex: number, row: CloseReviewRowRef, part: string): string {
  return `${callIndex}:${row.table}:${row.id}:${part}`
}

function areaOf(row: CloseReviewRowRef, lookup: CloseReviewLookup): CloseReviewArea | null {
  if (row.table !== 'entities') return AREA_BY_TABLE.get(row.table) ?? null
  const kind = lookup.entityKind(row.id)
  return kind === 'location' || kind === 'item' ? 'placesAndItems' : 'charactersAndFactions'
}

/** The cited turn latest on the branch, else the last cited, else none. */
function citedEntry(turns: readonly string[], lookup: CloseReviewLookup): string | null {
  let latest: { id: string; position: number } | undefined
  for (const id of turns) {
    const position = lookup.entryPosition(id)
    if (position !== undefined && (latest === undefined || position > latest.position))
      latest = { id, position }
  }
  return latest?.id ?? turns.at(-1) ?? null
}

function valueAt(payload: Delta['undoPayload'], path: string): unknown {
  let current: unknown = payload
  for (const key of path.split('.')) {
    if (!isJsonObject(current)) return undefined
    current = current[key]
  }
  return current
}

// A ledger keeps an entry id as stored (ID_PATTERN has no entry prefix); a known one reads as its ref.
function entryRefText(value: string, lookup: CloseReviewLookup): string | undefined {
  const position = lookup.entryPosition(value)
  return position === undefined ? undefined : formatEntryRef(position)
}

/** Where a value sits: its row's table and its delta path, which decide how a stored enum reads. */
type ValueAt = { table: string; path: string }

const STATUS_PATH = 'status'
const UNPLACED_PATH = 'state.unplaced'

const ENTITY_STATUS_COPY = {
  staged: 'world:status.staged',
  active: 'world:status.active',
  retired: 'world:status.retired',
} as const satisfies Record<Entity['status'], string>

const THREAD_STATUS_COPY = {
  pending: 'plot:status.pending',
  active: 'plot:status.active',
  resolved: 'plot:status.resolved',
  failed: 'plot:status.failed',
} as const satisfies Record<ThreadStatus, string>

type StatusKey =
  | (typeof ENTITY_STATUS_COPY)[keyof typeof ENTITY_STATUS_COPY]
  | (typeof THREAD_STATUS_COPY)[keyof typeof THREAD_STATUS_COPY]
type StatusCopy = Readonly<Record<string, StatusKey>>

const STATUS_COPY: ReadonlyMap<string, StatusCopy> = new Map<string, StatusCopy>([
  ['entities', ENTITY_STATUS_COPY],
  ['threads', THREAD_STATUS_COPY],
])

function statusCopy(table: string, value: string) {
  const copy = STATUS_COPY.get(table)
  return copy !== undefined && Object.hasOwn(copy, value) ? copy[value] : undefined
}

// A stored enum in the user's words: a row's status, the close's top mark; an unknown one has none.
function enumText({ table, path }: ValueAt, value: string): string | undefined {
  if (path === UNPLACED_PATH && value === CLOSE_TOP_LEVEL_VALUE)
    return t('chapters:review.topLevel')
  const copy = path === STATUS_PATH ? statusCopy(table, value) : undefined
  return copy === undefined ? undefined : t(copy)
}

// A stored old value as text: a list item by item, an enum in words, an entry id as its ref, a row
// id as its name.
function shownValue(value: unknown, at: ValueAt, lookup: CloseReviewLookup): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map((item) => shownValue(item, at, lookup)).join(', ')
  if (typeof value === 'string')
    return enumText(at, value) ?? entryRefText(value, lookup) ?? lookup.nameOf(value) ?? value
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

type Planned =
  | { op: 'create'; index: number; call: CloseReportCall; row: ReportRow }
  | { op: 'delete'; index: number; call: CloseReportCall; row: ReportRow; kept: ReportRow }
  | { op: 'update'; index: number; call: CloseReportCall; row: ReportRow; path: string }
type UpdateWrite = Extract<Planned, { op: 'update' }>

// Rows come from landed calls alone, so a delta with no call (a stamp, a reset, normalization, a
// merge's link rows) is never one.
function plannedRows(call: CloseReportCall, index: number): Planned[] {
  if (call.result !== 'ok') return []
  const paths = landedPaths(call)
  const { survivor } = call
  if (paths.length === 0 && survivor === undefined) return []
  if (call.tool === CREATE_LORE_TOOL) {
    const [row] = call.rows
    return row === undefined ? [] : [{ op: 'create', index, call, row }]
  }
  if (survivor !== undefined) {
    const kept = call.rows.find((row) => sameRow(row, survivor)) ?? { ...survivor, name: '' }
    return [
      ...call.rows
        .filter((row) => !sameRow(row, survivor))
        .map((row): Planned => ({ op: 'delete', index, call, row, kept })),
      ...paths.map((path): Planned => ({ op: 'update', index, call, row: kept, path })),
    ]
  }
  const [row] = call.rows
  if (row === undefined) return []
  return paths.map((path): Planned => ({ op: 'update', index, call, row, path }))
}

function appendTo<K, V>(buckets: Map<K, V[]>, key: K, value: V): void {
  const bucket = buckets.get(key)
  if (bucket === undefined) buckets.set(key, [value])
  else bucket.push(value)
}

const writeKey = (row: CloseReviewRowRef, path: string): string =>
  JSON.stringify([row.table, row.id, path])

/**
 * Old value per landed write: the kth-from-last write of a path on a row pairs with the
 * kth-from-last delta naming it, so an earlier writer's delta (a merge's link upsert) drops off.
 */
function oldValues(planned: readonly Planned[], deltas: readonly Delta[]): Map<Planned, unknown> {
  const logged = new Map<string, Delta[]>()
  for (const delta of deltas)
    for (const path of changedPaths(delta)) {
      const key = writeKey({ table: delta.targetTable, id: delta.targetId }, path)
      appendTo(logged, key, delta)
    }
  const writes = new Map<string, UpdateWrite[]>()
  for (const write of planned)
    if (write.op === 'update') {
      const key = writeKey(write.row, write.path)
      appendTo(writes, key, write)
    }
  const old = new Map<Planned, unknown>()
  for (const [key, list] of writes) {
    const found = logged.get(key) ?? []
    list.forEach((write, at) => {
      const delta = found[found.length - list.length + at]
      if (delta !== undefined) old.set(write, valueAt(delta.undoPayload, write.path))
    })
  }
  return old
}

const COMMON_KNOWLEDGE_PATH = 'commonKnowledge'

const flagText = (value: unknown): string =>
  Number(value) === 1 ? t('chapters:review.yes') : t('chapters:review.no')

/**
 * A new or proposed value as shown: flag as yes/no, '' as none, status or top mark in words, an
 * entry id as its ref, a row id the ledger couldn't name as its live name.
 */
export function reviewValueText(at: ValueAt, value: string, lookup: CloseReviewLookup): string {
  if (at.path === COMMON_KNOWLEDGE_PATH) return flagText(value)
  if (value === '') return t('chapters:review.none')
  return enumText(at, value) ?? entryRefText(value, lookup) ?? lookup.nameOf(value) ?? value
}

// The top mark names only its move, since its old value is the unplaced flag.
function updateSummary(
  at: ValueAt,
  old: unknown,
  value: string,
  lookup: CloseReviewLookup,
): string {
  const after = reviewValueText(at, value, lookup)
  if (at.path === UNPLACED_PATH) return after
  const before =
    at.path === COMMON_KNOWLEDGE_PATH
      ? old == null
        ? ''
        : flagText(old)
      : shownValue(old, at, lookup)
  return before === '' ? after : `${before}${VALUE_ARROW}${after}`
}

function summaryOf(write: Planned, old: unknown, lookup: CloseReviewLookup): string {
  if (write.op === 'create') return write.call.values?.body ?? ''
  if (write.op === 'delete')
    return t('chapters:review.mergedInto', { name: reviewTarget(write.kept, lookup).name })
  const at = { table: write.row.table, path: write.path }
  return updateSummary(at, old, write.call.values?.[write.path] ?? '', lookup)
}

/**
 * chapter-close.md → Review: one row per landed field (create, absorbed row), grouped by area.
 * `deltas` are the close's, in log order, as `loadCloseDeltas` returns them.
 */
export function closeReviewChanges(
  report: CloseReport,
  deltas: readonly Delta[],
  lookup: CloseReviewLookup,
): CloseReview['changes'] {
  const planned = report.calls.flatMap((call, index) => plannedRows(call, index))
  const old = oldValues(planned, deltas)
  const byArea = new Map<CloseReviewArea, CloseReviewChange[]>()
  for (const write of planned) {
    const area = areaOf(write.row, lookup)
    if (area === null) continue
    const pressTo = write.op === 'delete' ? write.kept : write.row
    const shared = {
      area,
      target: reviewTarget(write.row, lookup),
      summary: summaryOf(write, old.get(write), lookup),
      why: write.call.why,
      entryId: citedEntry(write.call.turns, lookup),
      pressTo: { table: pressTo.table, id: pressTo.id },
    }
    const row: CloseReviewChange =
      write.op === 'update'
        ? {
            ...shared,
            key: reviewRowKey(write.index, write.row, write.path),
            op: 'update',
            fieldPath: write.path,
            fieldLabel: reviewFieldLabel(write.row.table, write.path),
          }
        : {
            ...shared,
            key: reviewRowKey(write.index, write.row, write.op),
            op: write.op,
            fieldPath: null,
            fieldLabel: null,
          }
    appendTo(byArea, area, row)
  }
  return CLOSE_REVIEW_AREAS.flatMap((area) => {
    const rows = byArea.get(area)
    return rows === undefined ? [] : [{ area, rows }]
  })
}
