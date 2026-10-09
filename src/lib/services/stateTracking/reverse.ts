import type {
  TimeTracker,
  TrackedEntityType,
  WorldStateChangeRecord,
  WorldStateHeaderRecord,
  WorldStateRecord,
} from '$lib/types'
import { canonicalId, cloneState, rowsOf, withRows, type TrackedRow, type TrackedState } from './state'

/** A database write that carries the live state along with the plan. */
export type ReversalOp =
  | { kind: 'delete'; entityType: TrackedEntityType; id: string }
  | { kind: 'softDelete'; entityType: TrackedEntityType; id: string }
  | { kind: 'update'; entityType: TrackedEntityType; id: string; fields: Record<string, unknown> }
  /** Insert the row, or overwrite it and clear its tombstone. */
  | { kind: 'restore'; entityType: TrackedEntityType; row: TrackedRow }
  | { kind: 'clock'; timeTracker: TimeTracker | null }

export interface ReversalInput {
  state: TrackedState
  /** Records attached to the entries being reversed, in any order. */
  records: WorldStateRecord[]
  /** Story position of every entry a record is attached to. */
  entryPositions: Map<string, number>
  keepManual: boolean
}

export interface ReversalPlan {
  state: TrackedState
  ops: ReversalOp[]
  /** Manual changes in the range, oldest first. */
  manual: WorldStateChangeRecord[]
  /** Manual changes that could not be applied again, because what they changed is gone. */
  unkeepable: WorldStateChangeRecord[]
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

  constructor(state: TrackedState) {
    this.state = cloneState(state)
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
        const row = { ...(record.before as unknown as TrackedRow), deleted: false } as TrackedRow
        this.put(type, row)
        this.ops.push({ kind: 'restore', entityType: type, row })
        return
      }
    }
  }

  /** Applies a manual change again. False when what it changed no longer exists. */
  redo(record: WorldStateChangeRecord): boolean {
    const { entityType: type, entityId: id } = record
    switch (record.op) {
      case 'create': {
        if (!record.after) return false
        const row = record.after as unknown as TrackedRow
        if (record.before) this.remove(type, (record.before as { id: string }).id)
        this.put(type, row)
        this.ops.push({ kind: 'restore', entityType: type, row })
        return true
      }
      case 'update': {
        if (!record.after) return false
        if (this.patch(type, id, record.after)) return true
        // An override undone by the reversal: write it again over the row it shadowed.
        const shadow = this.shadowed.get(id)
        const visible = shadow && this.find(type, shadow.id)
        if (!visible) return false
        const override = {
          ...visible,
          ...record.after,
          id,
          branchId: record.branchId,
          overridesId: canonicalId(visible),
          deleted: false,
        } as TrackedRow
        this.remove(type, visible.id)
        this.put(type, override)
        this.ops.push({ kind: 'restore', entityType: type, row: override })
        return true
      }
      case 'delete':
      case 'softDelete':
        if (!this.find(type, id)) return false
        this.remove(type, id)
        this.ops.push({ kind: record.op, entityType: type, id })
        return true
    }
  }
}

/**
 * Undoes `records` over `state`, newest first, so that for every field the earliest recorded
 * value is the one left standing. With `keepManual`, manual changes are then applied again,
 * oldest first.
 */
export function planReversal(input: ReversalInput): ReversalPlan {
  const ordered = [...input.records].sort(byStoryOrder(input.entryPositions))
  const changes = ordered.filter((r): r is WorldStateChangeRecord => r.kind === 'change')
  const headers = ordered.filter((r): r is WorldStateHeaderRecord => r.kind === 'header')

  const ws = new Workspace(input.state)
  for (const record of [...changes].reverse()) ws.undo(record)

  const earliest = headers[0]
  if (earliest) {
    ws.state = { ...ws.state, timeTracker: earliest.clockBefore ? { ...earliest.clockBefore } : null }
    ws.ops.push({ kind: 'clock', timeTracker: earliest.clockBefore })
    // Classifier-only history recorded the current location apart from the location rows.
    if (earliest.coverage === 'classifier') restoreCurrentLocation(ws, earliest.locationBefore)
  }

  const manual = changes.filter((r) => r.origin === 'manual')
  const unkeepable: WorldStateChangeRecord[] = []
  if (input.keepManual) {
    for (const record of manual) if (!ws.redo(record)) unkeepable.push(record)
  }

  return { state: ws.state, ops: ws.ops, manual, unkeepable }
}

function restoreCurrentLocation(ws: Workspace, locationId: string | null): void {
  for (const location of ws.state.locations) {
    const current = location.id === locationId
    if (location.current !== current) ws.patch('location', location.id, { current })
  }
}
