import type { Delta } from '@/lib/db'
import { chunked } from '@/lib/db'
import { isJsonObject } from '@/lib/json-object'
import type { PlacePlacement } from '@/lib/world'

import type { DbCtx } from '../types'
import { isPayloadMetaKey, pruneUndoPartial } from './delta-encoding'
import { heldKey, type HeldRowIndex } from './held-rows'
import { whereForDelta, type TableEntry, type TermListField } from './registry'
import { termChanges, undoTermChange, type TermChange } from './term-list'
import {
  deltasOnRowsAfter,
  PLACEMENT_PATHS,
  rowKey,
  wroteField,
  wrotePath,
} from './user-precedence'

// generation-pipeline.md → Reverse-replay, "An undo reverts only its own write": a reversed
// delta undoes only what it did and yields any part a surviving later write changed, then rewrites
// those survivors' prior values as if it had never been written.

type ChainSet = {
  readonly branchId: string
  readonly rows: readonly Delta[]
  readonly held: HeldRowIndex
}

/** Each reversed row's log from its oldest reversed delta on, read once before the walk. */
export class ReversalChains {
  readonly #ctx: DbCtx
  readonly #held: HeldRowIndex
  readonly #byRow: ReadonlyMap<string, readonly Delta[]>
  readonly #inSet: ReadonlySet<string>
  readonly #ends = new Map<string, Promise<Readonly<Record<string, unknown>> | null>>()

  constructor(
    ctx: DbCtx,
    held: HeldRowIndex,
    byRow: ReadonlyMap<string, readonly Delta[]>,
    inSet: ReadonlySet<string>,
  ) {
    this.#ctx = ctx
    this.#held = held
    this.#byRow = byRow
    this.#inSet = inSet
  }

  /** Every delta on `d`'s row logged after it, the set's own included, oldest first. */
  later(d: Delta): readonly Delta[] {
    return (this.#byRow.get(rowKey(d)) ?? []).filter((e) => e.logPosition > d.logPosition)
  }

  /** The deltas on `d`'s row logged after it that the set doesn't reverse, oldest first. */
  survivors(d: Delta): readonly Delta[] {
    return this.later(d).filter((e) => !this.#inSet.has(e.id))
  }

  /** The row as it stands before the reversal, or the copy a delete holds, or null. */
  end(d: Delta, entry: TableEntry): Promise<Readonly<Record<string, unknown>> | null> {
    const key = rowKey(d)
    let found = this.#ends.get(key)
    if (!found) {
      found = (async () => {
        const [row] = (await this.#ctx.db
          .select()
          .from(entry.descriptor.table)
          .where(whereForDelta(entry.descriptor, d))) as Record<string, unknown>[]
        return row ?? this.#held.byRow.get(heldKey(d.targetTable, d.targetId))?.row ?? null
      })()
      this.#ends.set(key, found)
    }
    return found
  }
}

export async function loadChains(set: ChainSet, ctx: DbCtx): Promise<ReversalChains> {
  const byTable = new Map<string, { since: number; ids: Set<string> }>()
  for (const d of set.rows) {
    const group = byTable.get(d.targetTable) ?? { since: Infinity, ids: new Set<string>() }
    group.since = Math.min(group.since, d.logPosition)
    group.ids.add(d.targetId)
    byTable.set(d.targetTable, group)
  }
  const byRow = new Map<string, Delta[]>()
  for (const [table, { since, ids }] of byTable)
    for (const chunk of chunked([...ids]))
      for (const d of await deltasOnRowsAfter(ctx, set.branchId, table, chunk, since)) {
        const row = byRow.get(rowKey(d))
        if (row) row.push(d)
        else byRow.set(rowKey(d), [d])
      }
  for (const row of byRow.values()) row.sort((a, b) => a.logPosition - b.logPosition)
  return new ReversalChains(ctx, set.held, byRow, new Set(set.rows.map((d) => d.id)))
}

/** A change to one survivor's prior value at `column` and `path`. */
export type SurvivorEdit = {
  readonly survivor: Delta
  readonly column: string
  readonly path: readonly string[]
  readonly edit: (prior: unknown) => unknown
}

type TermUndo = { readonly key: string; readonly change: TermChange }

/** A list the row or held copy takes the undone terms in. */
export type ListUndo = {
  readonly list: TermListField
  readonly prior: readonly string[]
  /** The prior list was absent (a null sentinel): an emptied list goes back to absent. */
  readonly priorAbsent: boolean
  readonly terms: readonly TermUndo[]
}

/** What one reversed update writes: on the row (or held copy) and on survivors' priors. */
export type OwnWriteUndo = {
  /** The scalar and sub-field partial the row takes, as the undo payload records it. */
  readonly restorable: Record<string, unknown>
  readonly lists: readonly ListUndo[]
  readonly count: { readonly column: string; readonly shift: number } | null
  readonly edits: readonly SurvivorEdit[]
}

export function writesRow(undo: OwnWriteUndo): boolean {
  return Object.keys(undo.restorable).length > 0 || undo.lists.length > 0 || undo.count !== null
}

export function valueAt(container: unknown, column: string, path: readonly string[]): unknown {
  let node: unknown = isJsonObject(container) ? container[column] : undefined
  for (const key of path) {
    if (!isJsonObject(node)) return undefined
    node = node[key]
  }
  return node
}

// A delete's payload is the whole row, so it holds every field's prior.
function priorOf(
  d: Delta,
  column: string,
  path: readonly string[],
): { carried: boolean; value: unknown } {
  const payload = d.undoPayload
  if (payload == null) return { carried: false, value: undefined }
  if (d.op === 'delete') return { carried: true, value: valueAt(payload, column, path) }
  if (d.op !== 'update' || !Object.hasOwn(payload, column))
    return { carried: false, value: undefined }
  let node: unknown = payload[column]
  for (const key of path) {
    // A prior container recorded whole (null, or a value replaced outright) holds the path too.
    if (!isJsonObject(node)) return { carried: true, value: undefined }
    if (!Object.hasOwn(node, key)) return { carried: false, value: undefined }
    node = node[key]
  }
  return { carried: true, value: node }
}

// What `d` wrote at the field: the next carrier's prior, else the row before the reversal. The
// chain is read as it stood before any rewrite, so a survivor's own change is judged as logged.
async function resultOf(
  chains: ReversalChains,
  entry: TableEntry,
  d: Delta,
  column: string,
  path: readonly string[],
): Promise<unknown> {
  for (const later of chains.later(d)) {
    const prior = priorOf(later, column, path)
    if (prior.carried) return prior.value
  }
  return valueAt(await chains.end(d, entry), column, path)
}

/** A list value as terms: absent reads as empty; anything but strings isn't a list. */
function termsOf(value: unknown): readonly string[] | undefined {
  if (value == null) return []
  if (!Array.isArray(value) || !value.every((term) => typeof term === 'string')) return undefined
  return value
}

function listUndoneOn(
  value: unknown,
  list: TermListField,
  prior: readonly string[],
  terms: readonly TermUndo[],
): unknown {
  const current = termsOf(value)
  if (current === undefined) return value
  const out = terms.reduce<readonly string[]>(
    (acc, { key, change }) => undoTermChange(acc, key, change, prior, list.match),
    current,
  )
  return value == null && out.length === 0 ? value : out
}

/** `value` with the list undo applied; an emptied list whose prior was absent goes back to absent. */
export function undoneList(value: unknown, undo: ListUndo): unknown {
  const out = listUndoneOn(value, undo.list, undo.prior, undo.terms)
  return undo.priorAbsent && Array.isArray(out) && out.length === 0 ? null : out
}

// A close's normalization rewrites a record's keys, and a later write of the record logs only
// the keys it saw: restored key by key, an old spelling would come back beside the later record.
function yieldsStackablesWhole(entry: TableEntry, delta: Delta, later: readonly Delta[]): boolean {
  return (
    entry.table === 'entities' &&
    delta.source === 'chapter_close' &&
    wrotePath(later, 'state', ['stackables'])
  )
}

const isStackablesPath = (column: string, path: readonly string[]) =>
  column === 'state' && path[0] === 'stackables'

/**
 * `payload` less each column or sub-field a later write changed; a schema-backed column yields
 * sub-field by sub-field, and the column groups `wroteField` counts as one field yield together.
 * `onYield` hears each yielded path.
 */
function restorablePayload(
  entry: TableEntry,
  payload: Record<string, unknown>,
  later: readonly Delta[],
  stackablesWhole: boolean,
  onYield: (column: string, path: readonly string[]) => void,
): Record<string, unknown> {
  const restorable: Record<string, unknown> = {}
  for (const [col, partial] of Object.entries(payload)) {
    if (isPayloadMetaKey(col)) continue
    if (!Object.hasOwn(entry.columnSchemas, col)) {
      if (wroteField(later, entry.table, col, [])) onYield(col, [])
      else restorable[col] = partial
      continue
    }
    const kept = pruneUndoPartial(entry.columnSchemas[col], partial, (path) => {
      const yields =
        (stackablesWhole && isStackablesPath(col, path)) ||
        wroteField(later, entry.table, col, path)
      if (yields) onYield(col, path)
      return yields
    })
    if (kept !== undefined) restorable[col] = kept
  }
  return restorable
}

function withoutPath(partial: unknown, path: readonly string[]): unknown {
  if (path.length === 0 || !isJsonObject(partial)) return partial
  const [key, ...rest] = path
  if (!Object.hasOwn(partial, key)) return partial
  const out = { ...partial }
  if (rest.length === 0) delete out[key]
  else out[key] = withoutPath(out[key], rest)
  return out
}

// The encoder records an absent mark as null, so only `true` restores unplaced. A partial without
// the parent changed the mark alone, which sits beside a null parent, so the place was top-level.
export function undonePlacement(partial: Record<string, unknown>): PlacePlacement {
  if (partial.unplaced === true) return { kind: 'unplaced' }
  const parentId = partial.parent_location_id
  return typeof parentId === 'string' ? { kind: 'under', parentId } : { kind: 'top' }
}

// A placement prior decodes from both keys, an absent one as null. Both are set on the prior as it
// stands, so an older reversed write clears a key a newer one's rewrite added; a null stays absent.
function placementEdits(survivor: Delta, prior: PlacePlacement): SurvivorEdit[] {
  const setTo = (value: string | true | null) => (pending: unknown) =>
    pending === undefined && value === null ? undefined : value
  const parent = prior.kind === 'under' ? prior.parentId : null
  const unplaced = prior.kind === 'unplaced' ? true : null
  return [
    { survivor, column: 'state', path: ['parent_location_id'], edit: setTo(parent) },
    { survivor, column: 'state', path: ['unplaced'], edit: setTo(unplaced) },
  ]
}

// For a field, the first survivor that changed it takes the reversed delta's prior.
function fieldEdits(
  entry: TableEntry,
  delta: Delta,
  payload: Record<string, unknown>,
  updates: readonly Delta[],
  yielded: readonly { column: string; path: readonly string[] }[],
  stackablesWhole: boolean,
): SurvivorEdit[] {
  const edits: SurvivorEdit[] = []
  let placementDone = false
  for (const { column, path } of yielded) {
    if (stackablesWhole && isStackablesPath(column, path)) continue
    const isPlacement =
      entry.table === 'entities' &&
      column === 'state' &&
      path.length === 1 &&
      PLACEMENT_PATHS.includes(path[0])
    const first = updates.find((s) => wroteField([s], entry.table, column, path))
    if (!first) continue
    if (isPlacement) {
      if (placementDone) continue
      placementDone = true
      edits.push(
        ...placementEdits(first, undonePlacement(payload.state as Record<string, unknown>)),
      )
      continue
    }
    // A group member the survivor didn't log joins it, as the group is one field.
    const at = recordedAt(first, column, path)
    const prior = valueAt(payload, column, at)
    edits.push({ survivor: first, column, path: at, edit: () => prior })
  }
  return edits
}

// A survivor that logged a container whole (a null or a replaced value) holds the field at that
// container, which the reversed delta also replaced whole, so the rewrite lands there.
function recordedAt(survivor: Delta, column: string, path: readonly string[]): readonly string[] {
  let node: unknown = survivor.undoPayload?.[column]
  for (let i = 0; i < path.length; i++) {
    if (!isJsonObject(node)) return path.slice(0, i)
    node = node[path[i]]
  }
  return path
}

// A list inside a column recorded whole (null, or replaced outright) undoes with that column.
function holdsList(payload: Record<string, unknown>, list: TermListField): boolean {
  if (!Object.hasOwn(payload, list.column)) return false
  let node: unknown = payload[list.column]
  for (const key of list.path ?? []) {
    if (!isJsonObject(node) || !Object.hasOwn(node, key)) return false
    node = node[key]
  }
  return true
}

function withoutList(
  payload: Record<string, unknown>,
  list: TermListField,
): Record<string, unknown> {
  const path = list.path ?? []
  if (path.length === 0) return omit(payload, list.column)
  const partial = withoutPath(payload[list.column], path)
  return isJsonObject(partial) && Object.keys(partial).length === 0
    ? omit(payload, list.column)
    : { ...payload, [list.column]: partial }
}

/**
 * How reversing `delta`, an update, undoes only its own write: what reaches the row or held copy,
 * and the survivors' priors it rewrites.
 */
export async function planOwnWrite(
  chains: ReversalChains,
  entry: TableEntry,
  delta: Delta,
): Promise<OwnWriteUndo> {
  let payload: Record<string, unknown> = Object.fromEntries(
    Object.entries(delta.undoPayload ?? {}).filter(([key]) => !isPayloadMetaKey(key)),
  )
  const later = chains.survivors(delta)
  const updates = later.filter((d) => d.op === 'update')
  const edits: SurvivorEdit[] = []

  const lists: ListUndo[] = []
  for (const list of entry.termLists ?? []) {
    if (!holdsList(payload, list)) continue
    const path = list.path ?? []
    const priorValue = valueAt(payload, list.column, path)
    const prior = termsOf(priorValue)
    const result = termsOf(await resultOf(chains, entry, delta, list.column, path))
    // A list a broken chain recorded as something else undoes as a whole value.
    if (prior === undefined || result === undefined) continue
    payload = withoutList(payload, list)
    const priorAbsent = priorValue == null
    const terms: TermUndo[] = []
    for (const [key, change] of termChanges(prior, result, list.match)) {
      let stopped = false
      for (const survivor of updates) {
        if (!priorOf(survivor, list.column, path).carried) continue
        edits.push({
          survivor,
          column: list.column,
          path,
          edit: (value) =>
            undoneList(value, { list, prior, priorAbsent, terms: [{ key, change }] }),
        })
        if (await changedTerm(chains, entry, survivor, list, key)) {
          stopped = true
          break
        }
      }
      if (!stopped) terms.push({ key, change })
    }
    if (terms.length > 0) lists.push({ list, prior, priorAbsent, terms })
  }

  let count: OwnWriteUndo['count'] = null
  const counter = entry.counter
  if (counter && Object.hasOwn(payload, counter.column)) {
    const prior = payload[counter.column]
    const result = await resultOf(chains, entry, delta, counter.column, [])
    if (isCount(prior) && isCount(result)) {
      payload = omit(payload, counter.column)
      const shift = prior - result
      let stopped = false
      if (shift !== 0)
        for (const survivor of updates) {
          if (!priorOf(survivor, counter.column, []).carried) continue
          edits.push({
            survivor,
            column: counter.column,
            path: [],
            edit: (value) => (isCount(value) ? Math.max(0, value + shift) : value),
          })
          if (!counter.isRelative(survivor)) {
            stopped = true
            break
          }
        }
      if (!stopped && shift !== 0) count = { column: counter.column, shift }
    }
  }

  const yielded: { column: string; path: readonly string[] }[] = []
  const stackablesWhole = yieldsStackablesWhole(entry, delta, later)
  const restorable = restorablePayload(entry, payload, later, stackablesWhole, (column, path) =>
    yielded.push({ column, path }),
  )
  edits.push(...fieldEdits(entry, delta, payload, updates, yielded, stackablesWhole))
  return { restorable, lists, count, edits }
}

async function changedTerm(
  chains: ReversalChains,
  entry: TableEntry,
  survivor: Delta,
  list: TermListField,
  key: string,
): Promise<boolean> {
  const path = list.path ?? []
  const prior = termsOf(priorOf(survivor, list.column, path).value)
  const result = termsOf(await resultOf(chains, entry, survivor, list.column, path))
  if (prior === undefined || result === undefined) return true
  return termChanges(prior, result, list.match).has(key)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function omit(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const { [key]: _gone, ...rest } = payload
  return rest
}

/**
 * Sets `edit(prior)` at `column` and `path` in `payload`, leaving the key out when the edit gives
 * undefined; false when a container on the way isn't one.
 */
export function editPayloadAt(
  payload: Record<string, unknown>,
  column: string,
  path: readonly string[],
  edit: (prior: unknown) => unknown,
): boolean {
  let node: unknown = payload
  for (const key of [column, ...path].slice(0, -1)) {
    if (!isJsonObject(node)) return false
    node = node[key]
  }
  if (!isJsonObject(node)) return false
  const last = path.length === 0 ? column : path[path.length - 1]
  const value = edit(node[last])
  if (value === undefined) delete node[last]
  else node[last] = value
  return true
}
