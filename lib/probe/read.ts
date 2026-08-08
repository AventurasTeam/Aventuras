import type { ProbeCapturePayload, RowQuery, SqlOp } from '@/lib/db'
import { rowQuery } from '@/lib/db'

import { decompressPayload } from './compress'
import { assertRankerParams } from './validate'

export type StoredCapture = {
  id: string
  branchId: string
  capturedAt: number
  captureMode: 'light' | 'deep'
  failureReason: string | null
  payloadSize: number | null
  payload: ProbeCapturePayload
}

/** Newest first. Story-scoped, matching the per-story cap the writer enforces. */
export function capturesForStoryQuery(storyId: string): RowQuery {
  return rowQuery(
    `SELECT pc.id, pc.branch_id, pc.captured_at, pc.capture_mode, pc.failure_reason,
            pc.payload_size, pc.payload
       FROM probe_captures pc
       JOIN branches b ON b.id = pc.branch_id
      WHERE b.story_id = ?
      ORDER BY pc.captured_at DESC, pc.id DESC`,
    [storyId],
  )
}

/**
 * The one place a stored capture re-enters the ranker's world, so the params
 * guard runs here rather than at each caller.
 */
export function decodeCapture(row: readonly unknown[]): StoredCapture {
  const [id, branchId, capturedAt, captureMode, failureReason, payloadSize, payloadBytes] = row as [
    string,
    string,
    number,
    'light' | 'deep',
    string | null,
    number | null,
    Uint8Array,
  ]
  const payload = decompressPayload(payloadBytes) as ProbeCapturePayload
  assertRankerParams(payload.params.ranker)
  return { id, branchId, capturedAt, captureMode, failureReason, payloadSize, payload }
}

/**
 * Direct deletes, never delta-logged: probe_captures is absent from
 * deltas.target_table, and a delta-logged capture would mean rollback unwinds
 * probe data, the opposite of what a tuner wants (probe.md → Schema delta).
 * Returned as ops rather than executed so the caller supplies the same
 * runInTransaction the writer uses.
 */
export function deleteCaptureOp(branchId: string, id: string): SqlOp {
  return {
    sql: 'DELETE FROM probe_captures WHERE branch_id = ? AND id = ?',
    params: [branchId, id],
  }
}

export function clearCapturesForStoryOp(storyId: string): SqlOp {
  return {
    sql: `DELETE FROM probe_captures WHERE branch_id IN (SELECT id FROM branches WHERE story_id = ?)`,
    params: [storyId],
  }
}
