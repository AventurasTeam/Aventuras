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

/**
 * Stable identity for a target. A model id alone is NOT unique: the same id can
 * be installed locally and offered by a provider, and the two are different
 * embedders that happen to share a name. Anything keying, comparing or
 * de-duplicating targets must go through this rather than `modelId`.
 *
 * Provider id participates only for provider targets — a local model is the same
 * local model whatever provider row happens to be configured alongside it. It
 * deliberately does NOT reach vec row identity (`vecRowPk`), where vectors from
 * the same weights stay interchangeable regardless of who served them.
 */
export function embeddingTargetKey(target: EmbeddingTarget): string {
  return target.backend === 'provider'
    ? `provider:${target.providerId ?? ''}:${target.modelId}`
    : `local:${target.modelId}`
}

export function sameEmbeddingTarget(a: EmbeddingTarget, b: EmbeddingTarget): boolean {
  return embeddingTargetKey(a) === embeddingTargetKey(b)
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
 *
 * A local target also drops `effectiveDim`: truncation is provider-only, so on a
 * local story the value describes nothing while still reading as a live setting.
 * Note this is one-way — dim selection is wizard-only until M7, so a story that
 * moves to a local backend cannot get its truncation preference back.
 */
export function setEmbeddingTargetOp(
  storyId: string,
  target: EmbeddingTarget,
  nowMs: number,
): SqlOp {
  const isProvider = target.backend === 'provider'
  return patchSettingsOp(
    storyId,
    {
      embedding_model_id: target.modelId,
      embeddingBackend: target.backend,
      embedding_provider_id: isProvider ? (target.providerId ?? null) : null,
      ...(isProvider ? {} : { effectiveDim: null }),
    },
    nowMs,
  )
}
