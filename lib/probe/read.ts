import type { ProbeCapturePayload, RowQuery, SqlOp } from '@/lib/db'
import { rowQuery } from '@/lib/db'
import type { EmbedderErrorKind } from '@/lib/embedder'

import { decompressPayload } from './compress'
import { assertRankerParams, RankerParamsError } from './validate'

export type CorruptCapture = { id: string; branchId: string; error: Error }

export type StoredCapture = {
  id: string
  branchId: string
  capturedAt: number
  captureMode: ProbeCapturePayload['capture_mode']
  failureReason: EmbedderErrorKind | null
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
 * `row` must be a positional value-array matching capturesForStoryQuery's
 * column order: id, branch_id, captured_at, capture_mode, failure_reason,
 * payload_size, payload. An object-row caller must normalize to that shape
 * first (see lib/db/runtime/exec.ts). The one place a stored capture
 * re-enters the ranker's world, so the params guard runs here.
 */
export function decodeCapture(row: readonly unknown[]): StoredCapture {
  const [id, branchId, capturedAt, captureMode, failureReason, payloadSize, payloadBytes] = row as [
    string,
    string,
    number,
    ProbeCapturePayload['capture_mode'],
    EmbedderErrorKind | null,
    number | null,
    Uint8Array,
  ]
  const payload = decompressPayload(payloadBytes) as ProbeCapturePayload
  if (payload.params === undefined || payload.params === null)
    throw new RankerParamsError('params', 'capture payload has no params snapshot')
  assertRankerParams(payload.params.ranker)
  return { id, branchId, capturedAt, captureMode, failureReason, payloadSize, payload }
}

/**
 * List-path sibling to decodeCapture: isolates a corrupt row instead of
 * failing the whole list, so one bad capture out of a hundred doesn't blank
 * the browse screen or block deleting the very row that needs removing.
 * decodeCapture stays throwing for the replay/parity path, which wants a hard
 * failure rather than a silently skipped row.
 */
export function decodeCaptures(rows: readonly (readonly unknown[])[]): {
  ok: StoredCapture[]
  corrupt: CorruptCapture[]
} {
  const ok: StoredCapture[] = []
  const corrupt: CorruptCapture[] = []
  for (const row of rows) {
    try {
      ok.push(decodeCapture(row))
    } catch (error) {
      const [id, branchId] = row as [string, string]
      corrupt.push({
        id,
        branchId,
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }
  return { ok, corrupt }
}

/**
 * Direct deletes, never delta-logged: probe_captures is absent from
 * deltas.target_table, and a delta-logged capture would mean rollback unwinds
 * probe data, the opposite of what a tuner wants (probe.md → Schema delta).
 * Returned as ops, not executed: a delete is user-initiated, so its failure
 * must surface to the caller directly, unlike the writer's swallow-and-log.
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
