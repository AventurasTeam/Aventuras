/**
 * RollbackService — undoes the world state recorded for entries from a position onward.
 *
 * The plan comes from the reversal engine (`services/stateTracking`) over the live state, so
 * every recorded change is undone newest first, and is applied in one transaction: a revert
 * lands whole or not at all. Entries recorded before change records existed are read from
 * their `world_state_delta`.
 */

import type { StoryEntry, TrackedEntityType, WorldStateRecord } from '#lib/types/index.ts'
import { database, type DbStatement } from './database'
import {
  fromWorldStateDelta,
  planReversal,
  type ReversalOp,
  type ReversalPlan,
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
  keepManual: boolean
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
  const records = input.records.filter((r) => ids.has(r.entryId))
  const recorded = new Set(records.map((r) => r.entryId))
  for (const entry of reverted) {
    if (entry.worldStateDelta && !recorded.has(entry.id)) {
      records.push(...fromWorldStateDelta(entry, entry.worldStateDelta))
    }
  }
  return records
}

export function planRollback(input: RollbackInput): ReversalPlan & { records: WorldStateRecord[] } {
  const records = recordsFrom(input)
  const plan = planReversal({
    state: input.state,
    records,
    entryPositions: new Map(input.entries.map((e) => [e.id, e.position])),
    keepManual: input.keepManual,
  })
  return { ...plan, records }
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
      return [DELETE[t](op.id)]
    case 'softDelete':
      return [MARK_DELETED[t](op.id)]
    case 'update': {
      const stmt = UPDATE[t](op.id, op.fields)
      return stmt ? [stmt] : []
    }
    case 'restore':
      return [INSERT_OR_REPLACE[t]({ ...op.row, deleted: false } as TrackedRow)]
  }
}

const DELETE: Record<TrackedEntityType, (id: string) => DbStatement> = {
  character: (id) => database.deleteCharacterStatement(id),
  location: (id) => database.deleteLocationStatement(id),
  item: (id) => database.deleteItemStatement(id),
  story_beat: (id) => database.deleteStoryBeatStatement(id),
  lorebook_entry: (id) => database.deleteEntryStatement(id),
}

const MARK_DELETED: Record<TrackedEntityType, (id: string) => DbStatement> = {
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

const INSERT_OR_REPLACE: Record<TrackedEntityType, (row: TrackedRow) => DbStatement> = {
  character: (row) => database.addCharacterStatement(row as never, true),
  location: (row) => database.addLocationStatement(row as never, true),
  item: (row) => database.addItemStatement(row as never, true),
  story_beat: (row) => database.addStoryBeatStatement(row as never, true),
  lorebook_entry: (row) => database.addEntryStatement(row as never, true),
}

class RollbackService {
  /** Undoes the world state of entries at or after `fromPosition`. Throws without writing. */
  async rollbackFromPosition(input: RollbackInput): Promise<RollbackSummary> {
    const plan = planRollback(input)
    const statements = plan.ops.flatMap((op) => statementsFor(input.storyId, op))
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
      manualKept: input.keepManual ? plan.manual.length - plan.unkeepable.length : 0,
      unkeepable: input.keepManual ? plan.unkeepable.length : 0,
      restoredTimeTracker: plan.ops.some((op) => op.kind === 'clock'),
    }
    log('Rollback complete:', summary)
    return summary
  }
}

export const rollbackService = new RollbackService()
