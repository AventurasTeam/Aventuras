import { USER_EDITED_SINCE_PROSE, type PipelineAction, type RowVerdicts } from '@/lib/actions/types'
import { emptyEntityState, type Entity } from '@/lib/db'
import { isJsonObject } from '@/lib/json-object'

import { sameValue, type PlannedAction, type ProtectionReason } from './tool'
import { CLOSE_REASON } from './verdict'

export type FieldVerdict =
  | { field: string; free: true }
  | { field: string; free: false; reason: ProtectionReason }

type EntityPatch = Extract<PipelineAction, { kind: 'updateEntity' }>['payload']['patch']

/** A delta path inside `state`, the only kind `entityWriteAction` removes. */
export type StatePath = `state.${string}`

// A delta path is a column, then a path inside it: 'description', 'state.visual.face'.
function splitPath(field: string): { column: string; path: string[] } {
  const [column = '', ...path] = field.split('.')
  return { column, path }
}

function valueAt(node: unknown, path: readonly string[]): unknown {
  let current = node
  for (const key of path) {
    if (!isJsonObject(current)) return undefined
    current = current[key]
  }
  return current
}

function setAt(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let node = target
  for (const key of path.slice(0, -1)) {
    const next = node[key]
    const child = isJsonObject(next) ? next : {}
    node[key] = child
    node = child
  }
  node[path[path.length - 1]!] = value
}

function deleteAt(target: Record<string, unknown>, path: readonly string[]): void {
  const parent = valueAt(target, path.slice(0, -1))
  if (isJsonObject(parent)) delete parent[path[path.length - 1]!]
}

const stateCopyOf = (row: Entity): Record<string, unknown> =>
  JSON.parse(JSON.stringify(row.state ?? emptyEntityState(row.kind))) as Record<string, unknown>

/** A delta path's stored value on the row: a column, or a path inside its state. */
export function storedValue(row: Entity, field: string): unknown {
  const { column, path } = splitPath(field)
  if (column !== 'state' || path.length === 0) return row[column as keyof Entity]
  return valueAt(row.state ?? emptyEntityState(row.kind), path)
}

/**
 * The wanted delta paths whose value the row already holds. Drop them before `fieldVerdicts`: a
 * restated protected field reads `ok`, nothing written (C11), not skipped.
 */
export function restatedFields(row: Entity, wanted: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(wanted).filter((field) => sameValue(storedValue(row, field), wanted[field]))
}

/**
 * cadence.md → User edits and classifier writes: each delta path free, or protected with its
 * reason; the user's edit after the prose names the reason over a later turn's write. Reads only.
 */
export function fieldVerdicts(row: RowVerdicts, fields: readonly string[]): FieldVerdict[] {
  return fields.map((field) => {
    const { column, path } = splitPath(field)
    if (row.userWrote(column, path)) return { field, free: false, reason: USER_EDITED_SINCE_PROSE }
    if (row.laterTurnWrote(column, path))
      return { field, free: false, reason: CLOSE_REASON.laterTurn }
    return { field, free: true }
  })
}

/**
 * The one `updateEntity` a close writes on a row: `state.*` paths set or removed on a state copy
 * (a group refuses two `state` writes on one row). Stored or already-absent paths stay out of
 * `fields`; none left → no action. `state` is replaced whole: read it under the close's gate.
 */
export function entityWriteAction(
  row: Entity,
  wanted: Readonly<Record<string, unknown>>,
  removed: readonly StatePath[] = [],
): PlannedAction {
  const entries = Object.entries(wanted)
  if (entries.length === 0 && removed.length === 0)
    throw new Error(`entityWriteAction: nothing to write on ${row.id}`)
  const restated = new Set(restatedFields(row, wanted))
  const removing = removed.filter((field) => storedValue(row, field) !== undefined)
  const fields = [...Object.keys(wanted).filter((field) => !restated.has(field)), ...removing]
  const patch: Record<string, unknown> = {}
  let state: Record<string, unknown> | undefined
  for (const [field, value] of entries) {
    const { column, path } = splitPath(field)
    if (column === 'state' && path.length > 0) {
      state ??= stateCopyOf(row)
      setAt(state, path, value)
    } else {
      patch[column] = value
    }
  }
  for (const field of removing) {
    state ??= stateCopyOf(row)
    deleteAt(state, splitPath(field).path)
  }
  if (state !== undefined) patch.state = state
  return {
    action: {
      kind: 'updateEntity',
      source: 'chapter_close',
      payload: { branchId: row.branchId, id: row.id, patch: patch as EntityPatch },
    },
    fields,
    row: row.id,
  }
}
