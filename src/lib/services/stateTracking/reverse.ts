import type {
  TimeTracker,
  TrackedEntityType,
  WorldStateChangeRecord,
  WorldStateRecord,
} from '#lib/types/index.ts'
import {
  canonicalId,
  cloneState,
  rowsOf,
  withRows,
  type TrackedRow,
  type TrackedState,
} from './state'
import { UNRECORDED_FIELDS, recordedRow } from './record'

/** A database write that carries the live state along with the plan. */
export type ReversalOp =
  | { kind: 'delete'; entityType: TrackedEntityType; id: string }
  | { kind: 'softDelete'; entityType: TrackedEntityType; id: string }
  | { kind: 'update'; entityType: TrackedEntityType; id: string; fields: Record<string, unknown> }
  /** Insert the row, or overwrite it and clear its tombstone. */
  | { kind: 'restore'; entityType: TrackedEntityType; row: TrackedRow }
  /** Clear a tombstone; the row kept every column, unrecorded ones included. */
  | { kind: 'undelete'; entityType: TrackedEntityType; id: string }
  | { kind: 'clock'; timeTracker: TimeTracker | null }

export interface ReversalInput {
  state: TrackedState
  /** Records attached to the entries being reversed, in any order. */
  records: WorldStateRecord[]
  /** Story position of every entry a record is attached to. */
  entryPositions: Map<string, number>
  /**
   * Changes that belong to the state being rebuilt but were written after `state` was saved.
   * They are applied first, in write order.
   */
  late?: WorldStateChangeRecord[]
  /** Which of the reader's and Tidy's changes to apply again after the reversal. */
  keep: RevertKeep
  /** The clock to leave: the end time of the last entry that remains. Omitted, it is untouched. */
  clock?: TimeTracker | null
}

/** Which of the reader's and Tidy's changes a revert applies again. */
export type RevertKeep = { manual: boolean; tidy: boolean }

export const KEEP_ALL: RevertKeep = { manual: true, tidy: true }

/**
 * What a revert the reader confirms keeps: nothing. A kept change writes back whole field values,
 * so keeping an edit made over a reverted change would keep that change's text with it.
 */
export const KEEP_NONE: RevertKeep = { manual: false, tidy: false }

export interface ReversalPlan {
  state: TrackedState
  ops: ReversalOp[]
  /** Manual changes in the range, oldest first. */
  manual: WorldStateChangeRecord[]
  /** Changes from lore management the reader ran, in the range, oldest first. */
  tidy: WorldStateChangeRecord[]
  /** Kept changes that could not be applied again, because what they changed is gone. */
  unkeepable: WorldStateChangeRecord[]
  /**
   * The kept changes as they were applied again, in that order, each `before` read from the
   * state it landed on rather than copied from a record this reversal undid.
   */
  reapplied: WorldStateChangeRecord[]
  /** The chapter lore the range undoes, in story order. */
  chapter: WorldStateChangeRecord[]
  /** Whether the range undoes any change of the classifier's. */
  classifier: boolean
}

function byStoryOrder(positions: Map<string, number>) {
  return (a: WorldStateRecord, b: WorldStateRecord) =>
    (positions.get(a.entryId) ?? 0) - (positions.get(b.entryId) ?? 0) || a.seq - b.seq
}

class Workspace {
  state: TrackedState
  ops: ReversalOp[] = []
  /** Rows an undone create was shadowing, by the removed row's id. */
  shadowed = new Map<string, TrackedRow>()
  /** The rows as the plan found them, for the columns no record holds. */
  private readonly original: TrackedState

  constructor(state: TrackedState) {
    this.state = cloneState(state)
    this.original = state
  }

  /**
   * A row written again from a record takes the columns records leave out (a portrait, the
   * translations) from the row as it was, where it existed.
   */
  withUnrecorded(type: TrackedEntityType, row: TrackedRow): TrackedRow {
    const was = rowsOf(this.original, type).find((r) => r.id === row.id) as
      Record<string, unknown> | undefined
    if (!was) return row
    const kept = Object.fromEntries(
      [...UNRECORDED_FIELDS].filter((key) => key in was).map((key) => [key, was[key]]),
    )
    return { ...row, ...kept } as TrackedRow
  }

  find(type: TrackedEntityType, id: string): TrackedRow | undefined {
    return rowsOf(this.state, type).find((r) => r.id === id)
  }

  put(type: TrackedEntityType, row: TrackedRow): void {
    const rows = rowsOf(this.state, type).filter((r) => r.id !== row.id)
    this.state = withRows(this.state, type, [...rows, { ...row, deleted: false } as TrackedRow])
  }

  remove(type: TrackedEntityType, id: string): void {
    this.state = withRows(
      this.state,
      type,
      rowsOf(this.state, type).filter((r) => r.id !== id),
    )
  }

  patch(type: TrackedEntityType, id: string, fields: Record<string, unknown>): boolean {
    const row = this.find(type, id)
    if (!row) return false
    this.put(type, { ...row, ...fields } as TrackedRow)
    this.ops.push({ kind: 'update', entityType: type, id, fields })
    return true
  }

  undo(record: WorldStateChangeRecord): void {
    const { entityType: type, entityId: id } = record
    switch (record.op) {
      case 'create':
        this.remove(type, id)
        this.ops.push({ kind: 'delete', entityType: type, id })
        if (record.before) {
          const shadow = record.before as unknown as TrackedRow
          this.shadowed.set(id, shadow)
          this.put(type, shadow)
        }
        return
      case 'update':
        if (record.before) this.patch(type, id, record.before)
        return
      case 'delete':
      case 'softDelete': {
        if (!record.before) return
        const row = this.withUnrecorded(type, {
          ...(record.before as unknown as TrackedRow),
          deleted: false,
        } as TrackedRow)
        this.put(type, row)
        this.ops.push(
          record.op === 'softDelete'
            ? { kind: 'undelete', entityType: type, id }
            : { kind: 'restore', entityType: type, row },
        )
        return
      }
    }
  }

  /**
   * Applies a change again from its `after`, and returns it as it now applies: `before` read
   * from the state it lands on. Null when what it changed no longer exists.
   */
  redo(record: WorldStateChangeRecord): WorldStateChangeRecord | null {
    const { entityType: type, entityId: id } = record
    const applied = (
      op: WorldStateChangeRecord['op'],
      before: object | null,
      after: object | null,
    ): WorldStateChangeRecord => ({
      ...record,
      op,
      before: recordedRow(before),
      after: recordedRow(after),
    })
    switch (record.op) {
      case 'create': {
        if (!record.after) return null
        const row = this.withUnrecorded(type, record.after as unknown as TrackedRow)
        const shadowedId = record.before && (record.before as { id: string }).id
        const shadow = shadowedId ? (this.find(type, shadowedId) ?? null) : null
        if (shadowedId) this.remove(type, shadowedId)
        this.put(type, row)
        this.ops.push({ kind: 'restore', entityType: type, row })
        return applied('create', shadow, row)
      }
      case 'update': {
        if (!record.after) return null
        const current = this.find(type, id) as Record<string, unknown> | undefined
        if (current) {
          const before = Object.fromEntries(
            Object.keys(record.after).map((key) => [key, current[key] ?? null]),
          )
          this.patch(type, id, record.after)
          return applied('update', before, record.after)
        }
        // An override undone by the reversal: write it again over the row it shadowed.
        const shadow = this.shadowed.get(id)
        const visible = shadow && this.find(type, shadow.id)
        if (!visible) return null
        const override = this.withUnrecorded(type, {
          ...visible,
          ...record.after,
          id,
          branchId: record.branchId,
          overridesId: canonicalId(visible),
          deleted: false,
        } as TrackedRow)
        this.remove(type, visible.id)
        this.put(type, override)
        this.ops.push({ kind: 'restore', entityType: type, row: override })
        return applied('create', visible, override)
      }
      case 'delete':
      case 'softDelete': {
        const current = this.find(type, id)
        if (!current) return null
        this.remove(type, id)
        this.ops.push({ kind: record.op, entityType: type, id })
        return applied(record.op, current, null)
      }
    }
  }
}

/**
 * Applies `late` over `state`, then undoes `records`, newest first, so that for every field the
 * earliest recorded value is the one left standing. The kept origins are then applied again,
 * oldest first.
 */
export function planReversal(input: ReversalInput): ReversalPlan {
  const ordered = [...input.records].sort(byStoryOrder(input.entryPositions))
  const changes = ordered.filter((r): r is WorldStateChangeRecord => r.kind === 'change')

  const ws = new Workspace(input.state)
  for (const record of [...(input.late ?? [])].sort((a, b) => a.seq - b.seq)) ws.redo(record)
  for (const record of [...changes].reverse()) ws.undo(record)

  if (input.clock !== undefined) {
    ws.state = { ...ws.state, timeTracker: input.clock ? { ...input.clock } : null }
    ws.ops.push({ kind: 'clock', timeTracker: input.clock })
  }
  const manual = changes.filter((r) => r.origin === 'manual')
  const tidy = changes.filter((r) => r.origin === 'tidy')
  const kept = changes.filter(
    (r) => (input.keep.manual && r.origin === 'manual') || (input.keep.tidy && r.origin === 'tidy'),
  )
  const unkeepable: WorldStateChangeRecord[] = []
  const reapplied: WorldStateChangeRecord[] = []
  for (const record of kept) {
    const applied = ws.redo(record)
    if (applied) reapplied.push(applied)
    else unkeepable.push(record)
  }
  const chapter = changes
    .filter((r) => r.origin === 'chapter')
    .sort(byStoryOrder(input.entryPositions))

  return {
    state: ws.state,
    ops: ws.ops,
    manual,
    tidy,
    unkeepable,
    reapplied,
    chapter,
    classifier: changes.some((r) => r.origin === 'classifier'),
  }
}

/**
 * The clock once everything from `position` on is gone: the end time of the last entry before
 * it that has one. A gap before the removed entries goes with them. Null when none has a time.
 */
export function clockAfter(
  entries: { position: number; metadata?: { timeEnd?: TimeTracker } | null }[],
  position: number,
): TimeTracker | null {
  let found: TimeTracker | null = null
  let at = -Infinity
  for (const entry of entries) {
    const end = entry.metadata?.timeEnd
    if (end && entry.position < position && entry.position > at) {
      found = end
      at = entry.position
    }
  }
  return found ? { ...found } : null
}
