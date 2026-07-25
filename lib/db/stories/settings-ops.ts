import type { SqlOp } from '../types'

/**
 * Where a swap is sending the story. `backend` and `providerId` ride along
 * because a cross-backend swap has to survive a crash: the marker is the only
 * record of the target, and resolving a provider model id against the story's
 * still-current local backend fails as `unknown-local-model`.
 */
export type EmbeddingTarget = {
  modelId: string
  backend: 'provider' | 'local'
  providerId?: string | null
}

// json_patch, not json_set: these writes have to CLEAR a key as well as set one
// (a local target carries no provider id), and merge-patch semantics delete on a
// null value where json_set would write a JSON null the settings Zod rejects.
// Raw ops rather than updateStorySettings because every swap transition commits
// atomically WITH its vec0 ops in one transaction, and the action's
// read-merge-write is a separate-transaction race (docs/implementation/triage.md).
function patchSettingsOp(storyId: string, patch: Record<string, unknown>, nowMs: number): SqlOp {
  return {
    sql: `UPDATE stories SET settings = json_patch(settings, json(?)), updated_at = ? WHERE id = ?`,
    params: [JSON.stringify(patch), nowMs, storyId],
  }
}

export function setSwapTargetOp(storyId: string, target: EmbeddingTarget, nowMs: number): SqlOp {
  return patchSettingsOp(
    storyId,
    {
      embedding_swap_target: target.modelId,
      embedding_swap_backend: target.backend,
      embedding_swap_provider_id: target.providerId ?? null,
    },
    nowMs,
  )
}

export function clearSwapTargetOp(storyId: string, nowMs: number): SqlOp {
  return patchSettingsOp(
    storyId,
    {
      embedding_swap_target: null,
      embedding_swap_backend: null,
      embedding_swap_provider_id: null,
    },
    nowMs,
  )
}

/**
 * Phase-2's flip. Writes the backend and provider id alongside the model id so a
 * cross-backend swap lands a coherent trio — a model-id-only flip would leave
 * the story pointing at a provider model under its old local backend.
 */
export function setEmbeddingTargetOp(
  storyId: string,
  target: EmbeddingTarget,
  nowMs: number,
): SqlOp {
  return patchSettingsOp(
    storyId,
    {
      embedding_model_id: target.modelId,
      embeddingBackend: target.backend,
      embedding_provider_id: target.backend === 'provider' ? (target.providerId ?? null) : null,
    },
    nowMs,
  )
}
