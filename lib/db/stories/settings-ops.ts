import { storySettingsSchema, type StorySettings } from './story-config-schema'
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
  // Only the provider id is encoded: it is a generated `prov_<uuid>`, so this is
  // the identity for every real one, keeping the key readable as the
  // swap-candidate testID. The model id is free-form and colon-bearing ids are
  // common (`nomic-embed-text:latest`), but it is the trailing segment, so it
  // cannot make one key parse two ways.
  return target.backend === 'provider'
    ? `provider:${encodeURIComponent(target.providerId ?? '')}:${target.modelId}`
    : `local:${target.modelId}`
}

export function sameEmbeddingTarget(a: EmbeddingTarget, b: EmbeddingTarget): boolean {
  return embeddingTargetKey(a) === embeddingTargetKey(b)
}

export type SwapDimensions = {
  sourceDim?: number | null
  targetDim?: number | null
}

// json_patch, not json_set: these writes must CLEAR keys, and merge-patch deletes
// on null where json_set writes a JSON null the settings Zod rejects. Raw ops
// rather than updateStorySettings: swap transitions commit with their vec0 ops.
function patchSettingsOp(storyId: string, patch: Record<string, unknown>, nowMs: number): SqlOp {
  return {
    sql: `UPDATE stories SET settings = json_patch(settings, json(?)), updated_at = ? WHERE id = ?`,
    params: [JSON.stringify(patch), nowMs, storyId],
  }
}

/**
 * Guards both settings-write paths: this module's key interpolation, and
 * `updateStorySettings`, where zod would silently strip a typo'd key instead.
 *
 * @throws naming every offending key.
 */
export function assertKnownSettingsKeys(keys: readonly string[]): void {
  // `hasOwn`, not `in`: `in` walks the prototype chain, so `constructor` and
  // `toString` would pass the guard.
  const unknown = keys.filter((key) => !Object.hasOwn(storySettingsSchema.shape, key))
  if (unknown.length > 0) {
    throw new Error(`Unknown story-settings key(s): ${unknown.join(', ')}`)
  }
}

/**
 * The settings write for everything that is not a swap transition. Key-scoped, so
 * a concurrent writer cannot lose to it. json_set, not the json_patch above:
 * merge-patch would delete a required-nullable key like `activePackId` on an
 * explicit null and would merge nested objects callers mean to replace. Returns no
 * op for an empty patch — `json_set(settings, )` is a syntax error.
 *
 * @throws if a key is absent from `storySettingsSchema`, which is what makes the
 * unparameterised key interpolation safe.
 * @throws if a value is `undefined` — no bindable SQL form, so "leave this key
 * alone" means dropping it.
 */
export function setSettingsKeysOps(
  storyId: string,
  values: Partial<StorySettings>,
  nowMs: number,
): SqlOp[] {
  const entries = Object.entries(values)
  assertKnownSettingsKeys(entries.map(([key]) => key))
  // `JSON.stringify(undefined)` is `undefined`, which node:sqlite rejects as an
  // unbindable parameter — naming the key beats that opaque TypeError.
  const missing = entries.filter(([, value]) => value === undefined)
  if (missing.length > 0) {
    throw new Error(
      `Undefined value for story-settings key(s): ${missing.map(([key]) => key).join(', ')}`,
    )
  }
  if (entries.length === 0) return []
  // Every key costs two of json_set's arguments plus one for the column, so even
  // the whole schema is 55 — well inside SQLite's function-argument ceiling.
  const setArgs = entries.map(([key]) => `'$.${key}', json(?)`).join(', ')
  return [
    {
      sql: `UPDATE stories SET settings = json_set(settings, ${setArgs}), updated_at = ? WHERE id = ?`,
      params: [...entries.map(([, value]) => JSON.stringify(value)), nowMs, storyId],
    },
  ]
}

export function setSwapTargetOp(
  storyId: string,
  target: EmbeddingTarget,
  nowMs: number,
  dimensions: SwapDimensions = {},
): SqlOp {
  return patchSettingsOp(
    storyId,
    {
      embedding_swap_target: target.modelId,
      embedding_swap_backend: target.backend,
      embedding_swap_provider_id: target.providerId ?? null,
      embedding_swap_source_dim: dimensions.sourceDim ?? null,
      embedding_swap_target_dim: dimensions.targetDim ?? null,
    },
    nowMs,
  )
}

export function setSwapTargetDimOp(storyId: string, targetDim: number, nowMs: number): SqlOp {
  return patchSettingsOp(storyId, { embedding_swap_target_dim: targetDim }, nowMs)
}

export function clearSwapTargetOp(storyId: string, nowMs: number): SqlOp {
  return patchSettingsOp(
    storyId,
    {
      embedding_swap_target: null,
      embedding_swap_backend: null,
      embedding_swap_provider_id: null,
      embedding_swap_source_dim: null,
      embedding_swap_target_dim: null,
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
