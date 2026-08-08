import type { SqlOp } from '@/lib/db'
import { logger } from '@/lib/diagnostics'

import { compressPayload } from './compress'
import { buildCapturePayload, type CapturePayloadInput } from './payload'

/** probe.md → Eviction. Fixed in v1, not user-tunable. */
export const CAPTURE_CAP = 100

export type CaptureWriteDeps = { runInTransaction: (ops: SqlOp[]) => Promise<void> }

export type CaptureWriteInput = CapturePayloadInput & {
  id: string
  appGateOn: boolean
  storyGateOn: boolean
  failureReason: string | null
}

const INSERT_SQL = `INSERT INTO probe_captures
  (branch_id, id, target_entry_id, captured_at, capture_mode, embedding_model_id, failure_reason, payload, payload_size)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`

// Trims to the newest CAPTURE_CAP for the whole story rather than the branch:
// branching must not multiply the capture budget (probe.md → Eviction). Issued
// after the INSERT in the same batch, so no read-then-write race exists and a
// table somehow over cap self-heals on the next write.
const EVICT_SQL = `DELETE FROM probe_captures WHERE (branch_id, id) IN (
    SELECT pc.branch_id, pc.id FROM probe_captures pc
    JOIN branches b ON b.id = pc.branch_id
    WHERE b.story_id = (SELECT story_id FROM branches WHERE id = ?)
    ORDER BY pc.captured_at DESC, pc.id DESC
    LIMIT -1 OFFSET ?
  )`

export async function writeProbeCapture(
  deps: CaptureWriteDeps,
  input: CaptureWriteInput,
): Promise<'written' | 'gated' | 'failed'> {
  if (!input.appGateOn || !input.storyGateOn) return 'gated'

  try {
    const { bytes, uncompressedSize } = compressPayload(buildCapturePayload(input))
    await deps.runInTransaction([
      {
        sql: INSERT_SQL,
        params: [
          input.branchId,
          input.id,
          input.targetEntryId,
          input.capturedAt,
          input.mode,
          input.embeddingModelId,
          input.failureReason,
          bytes,
          uncompressedSize,
        ],
      },
      { sql: EVICT_SQL, params: [input.branchId, CAPTURE_CAP] },
    ])
    return 'written'
  } catch (error) {
    // Diagnostic data must never fail a turn (probe.md → Capture write failure).
    logger.warn('memory.probe_capture_write_failed', {
      detail: error instanceof Error ? error.message : String(error),
    })
    return 'failed'
  }
}
