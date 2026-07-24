import type { SqlOp } from '../types'

// Raw json_set/json_remove, not updateStorySettings: the swap transitions must
// commit atomically WITH their vec0 ops in one transaction, and the action's
// read-merge-write is a separate-transaction race (docs/implementation/triage.md).
export function setSwapTargetOp(storyId: string, targetModelId: string, nowMs: number): SqlOp {
  return {
    sql: `UPDATE stories SET settings = json_set(settings, '$.embedding_swap_target', ?), updated_at = ? WHERE id = ?`,
    params: [targetModelId, nowMs, storyId],
  }
}

export function clearSwapTargetOp(storyId: string, nowMs: number): SqlOp {
  return {
    sql: `UPDATE stories SET settings = json_remove(settings, '$.embedding_swap_target'), updated_at = ? WHERE id = ?`,
    params: [nowMs, storyId],
  }
}

export function setEmbeddingModelIdOp(storyId: string, modelId: string, nowMs: number): SqlOp {
  return {
    sql: `UPDATE stories SET settings = json_set(settings, '$.embedding_model_id', ?), updated_at = ? WHERE id = ?`,
    params: [modelId, nowMs, storyId],
  }
}
