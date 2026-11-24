import { isUndoKind, UNDO_KIND_KEY, type UndoKind } from './kinds'

/** One delta of an undo target's group, as the describe step reads it. */
export type UndoGroupDelta = {
  actionId: string
  source: string
  targetTable: string
  targetId: string
  op: 'create' | 'update' | 'delete'
  entryId: string | null
  undoPayload: Record<string, unknown> | null
}

export type UndoRowRef = { table: string; id: string }

/**
 * What an undo or redo reverses, by reader-composer.md → Undo and redo's description table. A
 * target is `seen` when the reader shows its result in place; every other target confirms first.
 */
export type UndoDescription =
  | { kind: 'turn'; seen: true; entryId: string }
  | { kind: 'tagged'; seen: true; undoKind: UndoKind; entryId: string }
  | { kind: 'close'; seen: false; chapterId: string }
  | { kind: 'rerun'; seen: false; chapterId: string }
  | { kind: 'keptClose'; seen: false; entryId: string | null }
  | { kind: 'leadSet'; seen: false; row: UndoRowRef }
  | { kind: 'leadUnset'; seen: false; row: UndoRowRef }
  | { kind: 'row'; seen: false; op: UndoGroupDelta['op']; row: UndoRowRef }
  | { kind: 'rows'; seen: false; first: UndoRowRef; more: number }
  | { kind: 'latest'; seen: false }

const ENTRIES = 'story_entries'

/** Rows History links to a row of its own; named from their entity end (link-rows.ts). */
export const UNDO_LINK_TABLES: ReadonlySet<string> = new Set([
  'character_relationships',
  'happening_involvements',
  'happening_awareness',
])

/** The tables undo can name a row of: History's own, chapters, and History's link tables. */
export const UNDO_NAMED_TABLES: ReadonlySet<string> = new Set([
  'entities',
  'lore',
  'threads',
  'happenings',
  'chapters',
  ...UNDO_LINK_TABLES,
])

function rowsWritten(deltas: readonly UndoGroupDelta[]): UndoRowRef[] {
  const seen = new Set<string>()
  const rows: UndoRowRef[] = []
  // Newest first in, so the oldest write is last: "the first row it wrote" reads from the end.
  for (const delta of [...deltas].reverse()) {
    if (delta.targetTable === ENTRIES) continue
    const key = `${delta.targetTable}\u0000${delta.targetId}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ table: delta.targetTable, id: delta.targetId })
  }
  return rows
}

function rowOp(deltas: readonly UndoGroupDelta[], row: UndoRowRef): UndoGroupDelta['op'] {
  const ops = new Set(
    deltas.filter((d) => d.targetTable === row.table && d.targetId === row.id).map((d) => d.op),
  )
  if (ops.has('create')) return 'create'
  if (ops.has('delete')) return 'delete'
  return 'update'
}

function closeDescription(deltas: readonly UndoGroupDelta[]): UndoDescription {
  const chapterWrites = deltas.filter((d) => d.targetTable === 'chapters')
  const created = chapterWrites.find((d) => d.op === 'create')
  if (created != null) return { kind: 'close', seen: false, chapterId: created.targetId }
  const updated = chapterWrites.find((d) => d.op === 'update')
  if (updated != null) return { kind: 'rerun', seen: false, chapterId: updated.targetId }
  // A divider-only removal kept this work: every delta still anchors on the chapter's end entry.
  const anchor = deltas.find((d) => d.entryId != null)?.entryId ?? null
  return { kind: 'keptClose', seen: false, entryId: anchor }
}

const LEAD_FLAG = 'isLead'

/**
 * A user group writing the lead flag, besides a delete: the row it sets (its undo payload holds
 * the flag off), else the oldest row it clears.
 */
function leadDescription(deltas: readonly UndoGroupDelta[]): UndoDescription | null {
  if (deltas.some((d) => d.op === 'delete')) return null
  const flagWrites = deltas.filter(
    (d) =>
      d.targetTable === 'entities' &&
      d.op === 'update' &&
      d.undoPayload != null &&
      Object.hasOwn(d.undoPayload, LEAD_FLAG),
  )
  if (flagWrites.length === 0) return null
  const set = flagWrites.find((d) => d.undoPayload?.[LEAD_FLAG] === 0)
  if (set != null)
    return { kind: 'leadSet', seen: false, row: { table: 'entities', id: set.targetId } }
  return { kind: 'leadUnset', seen: false, row: rowsWritten(flagWrites)[0] }
}

function userGroupDescription(deltas: readonly UndoGroupDelta[]): UndoDescription {
  const lead = leadDescription(deltas)
  if (lead != null) return lead
  const rows = rowsWritten(deltas)
  const named = rows.filter((row) => UNDO_NAMED_TABLES.has(row.table))
  if (named.length === 0) return { kind: 'latest', seen: false }
  if (rows.length === 1)
    return { kind: 'row', seen: false, op: rowOp(deltas, rows[0]), row: rows[0] }
  const first = named.find((row) => !UNDO_LINK_TABLES.has(row.table)) ?? named[0]
  return { kind: 'rows', seen: false, first, more: rows.length - 1 }
}

/**
 * The group's description, the table's first match winning. `deltas` is one action's rows, newest
 * first as the delta log reads them; a redo snapshot's go through `describeRedoTarget`.
 */
export function describeUndoGroup(deltas: readonly UndoGroupDelta[]): UndoDescription {
  // Newest first, so the last create is the turn's earliest entry, as selectUndoTarget anchors it.
  const turnCreate = deltas.filter((d) => d.targetTable === ENTRIES && d.op === 'create').at(-1)
  if (turnCreate != null) return { kind: 'turn', seen: true, entryId: turnCreate.targetId }

  for (const delta of deltas) {
    const tag = delta.targetTable === ENTRIES ? delta.undoPayload?.[UNDO_KIND_KEY] : undefined
    if (isUndoKind(tag))
      return { kind: 'tagged', seen: true, undoKind: tag, entryId: delta.targetId }
  }

  if (deltas.some((d) => d.source === 'chapter_close')) return closeDescription(deltas)
  if (deltas.some((d) => d.source === 'user_edit')) return userGroupDescription(deltas)
  return { kind: 'latest', seen: false }
}

/** A redo snapshot holds its target and the closure it reached; only the target is described. */
export function describeRedoTarget(group: {
  actionId: string
  snapshots: readonly { delta: UndoGroupDelta }[]
}): UndoDescription {
  return describeUndoGroup(
    group.snapshots.map((s) => s.delta).filter((d) => d.actionId === group.actionId),
  )
}
