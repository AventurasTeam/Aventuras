/**
 * RollbackService — undoes the world state recorded for entries from a position onward.
 *
 * The plan comes from the reversal engine (`services/stateTracking`) over the live state, so
 * every recorded change is undone newest first, and is applied in one transaction: a revert
 * lands whole or not at all. Entries recorded before change records existed are read from
 * their `world_state_delta`.
 */

import type {
  StoryEntry,
  TrackedEntityType,
  WorldStateChangeRecord,
  WorldStateRecord,
} from '#lib/types/index.ts'
import { database, type DbStatement } from './database'
import {
  clockAfter,
  withLegacyRecords,
  planReversal,
  type ReversalOp,
  type ReversalPlan,
  type RevertKeep,
  type TrackedRow,
  type TrackedState,
} from './stateTracking'
import { createLogger } from '#lib/log.ts'

const log = createLogger('RollbackService')

export interface RollbackInput {
  storyId: string
  branchId: string | null
  /** Entries at or after this position are reverted. */
  fromPosition: number
  /** Every entry visible on the branch. */
  entries: StoryEntry[]
  /** The branch's live world state. */
  state: TrackedState
  /** Change records on the branch line. */
  records: WorldStateRecord[]
  /** Which of the reader's and Tidy's changes to apply again after the revert. */
  keep: RevertKeep
}

export interface RollbackSummary {
  entriesProcessed: number
  entriesWithRecords: number
  changesUndone: number
  manualKept: number
  unkeepable: number
  restoredTimeTracker: boolean
}

/** The records to undo for a revert from `fromPosition`, older delta documents included. */
function recordsFrom(input: RollbackInput): WorldStateRecord[] {
  const reverted = input.entries.filter((e) => e.position >= input.fromPosition)
  const ids = new Set(reverted.map((e) => e.id))
  return withLegacyRecords(
    reverted,
    input.records.filter((r) => ids.has(r.entryId)),
  )
}

export function planRollback(
  input: RollbackInput,
): ReversalPlan & { records: WorldStateRecord[]; rerecorded: WorldStateChangeRecord[] } {
  const records = recordsFrom(input)
  const plan = planReversal({
    state: input.state,
    records,
    entryPositions: new Map(input.entries.map((e) => [e.id, e.position])),
    keep: input.keep,
    // Only a revert that removes entries moves the clock.
    clock: input.entries.some((e) => e.position >= input.fromPosition)
      ? clockAfter(input.entries, input.fromPosition)
      : undefined,
  })
  return { ...plan, records, rerecorded: rerecordKept(input, plan) }
}

/**
 * The kept changes, recorded again on the entry that now ends the branch: their own records go
 * with the removed entries, and without new ones nothing could undo or list them later. They are
 * new writes, so they take the revert's time; their order and `before` are as the plan applied them.
 */
function rerecordKept(input: RollbackInput, plan: ReversalPlan): WorldStateChangeRecord[] {
  const last = input.entries
    .filter((e) => e.position < input.fromPosition)
    .reduce<StoryEntry | null>((a, e) => (!a || e.position > a.position ? e : a), null)
  if (!last) return []
  const now = Date.now()
  return plan.reapplied.map((r) => ({
    ...r,
    id: crypto.randomUUID(),
    entryId: last.id,
    createdAt: now,
  }))
}

function statementsFor(storyId: string, op: ReversalOp): DbStatement[] {
  if (op.kind === 'clock') {
    return [
      op.timeTracker
        ? database.saveTimeTrackerStatement(storyId, op.timeTracker)
        : database.clearTimeTrackerStatement(storyId),
    ]
  }
  const t = op.entityType
  switch (op.kind) {
    case 'delete':
      return [DELETE_ROW[t](op.id)]
    case 'softDelete':
      return [MARK_ROW_DELETED[t](op.id)]
    case 'update': {
      const stmt = UPDATE[t](op.id, op.fields)
      return stmt ? [stmt] : []
    }
    case 'restore':
      return [addRowStatement(t, { ...op.row, deleted: false } as TrackedRow, true)]
    case 'undelete':
      return [database.clearTombstoneStatement(TABLE[t], op.id)]
  }
}

const TABLE = {
  character: 'characters',
  location: 'locations',
  item: 'items',
  story_beat: 'story_beats',
  lorebook_entry: 'entries',
} as const satisfies Record<TrackedEntityType, string>

export const DELETE_ROW: Record<TrackedEntityType, (id: string) => DbStatement> = {
  character: (id) => database.deleteCharacterStatement(id),
  location: (id) => database.deleteLocationStatement(id),
  item: (id) => database.deleteItemStatement(id),
  story_beat: (id) => database.deleteStoryBeatStatement(id),
  lorebook_entry: (id) => database.deleteEntryStatement(id),
}

export const MARK_ROW_DELETED: Record<TrackedEntityType, (id: string) => DbStatement> = {
  character: (id) => database.markCharacterDeletedStatement(id),
  location: (id) => database.markLocationDeletedStatement(id),
  item: (id) => database.markItemDeletedStatement(id),
  story_beat: (id) => database.markStoryBeatDeletedStatement(id),
  lorebook_entry: (id) => database.markEntryDeletedStatement(id),
}

const UPDATE: Record<
  TrackedEntityType,
  (id: string, fields: Record<string, unknown>) => DbStatement | null
> = {
  character: (id, f) => database.updateCharacterStatement(id, f),
  location: (id, f) => database.updateLocationStatement(id, f),
  item: (id, f) => database.updateItemStatement(id, f),
  story_beat: (id, f) => database.updateStoryBeatStatement(id, f),
  lorebook_entry: (id, f) => database.updateEntryStatement(id, f),
}

/** Adds a row; with `replace`, overwrites one restored under its original id. */
export function addRowStatement(
  type: TrackedEntityType,
  row: TrackedRow,
  replace = false,
): DbStatement {
  switch (type) {
    case 'character':
      return database.addCharacterStatement(row as never, replace)
    case 'location':
      return database.addLocationStatement(row as never, replace)
    case 'item':
      return database.addItemStatement(row as never, replace)
    case 'story_beat':
      return database.addStoryBeatStatement(row as never, replace)
    case 'lorebook_entry':
      return database.addEntryStatement(row as never, replace)
  }
}

class RollbackService {
  /** Undoes the world state of entries at or after `fromPosition`. Throws without writing. */
  async rollbackFromPosition(input: RollbackInput): Promise<RollbackSummary> {
    const plan = planRollback(input)
    const statements = [
      ...plan.ops.flatMap((op) => statementsFor(input.storyId, op)),
      ...plan.rerecorded.map((r) => database.worldStateRecordStatement(r)),
    ]
    await database.transaction(statements)

    try {
      await database.deleteWorldStateSnapshotsAfter(
        input.storyId,
        input.branchId,
        input.fromPosition - 1,
      )
      const cleaned = await database.cleanupNoopOverrides(input.storyId, input.branchId)
      if (cleaned > 0) log('Cleaned up', cleaned, 'no-op COW override(s)')
    } catch (error) {
      console.error('[RollbackService] Cleanup after rollback failed:', error)
    }

    const summary: RollbackSummary = {
      entriesProcessed: input.entries.filter((e) => e.position >= input.fromPosition).length,
      entriesWithRecords: new Set(plan.records.map((r) => r.entryId)).size,
      changesUndone: plan.records.filter((r) => r.kind === 'change').length,
      manualKept:
        (input.keep.manual ? plan.manual.length : 0) +
        (input.keep.tidy ? plan.tidy.length : 0) -
        plan.unkeepable.length,
      unkeepable: plan.unkeepable.length,
      restoredTimeTracker: plan.ops.some((op) => op.kind === 'clock'),
    }
    log('Rollback complete:', summary)
    return summary
  }
}

export const rollbackService = new RollbackService()
