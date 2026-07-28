import type { ProviderInstanceWithStub } from '@/lib/ai'
import {
  clearEmbeddingStaleOp,
  compositeText,
  ensureVecTables,
  packFloat32,
  sourceHash,
  upsertVecOps,
  type EmbeddedFieldRow,
  type SqlOp,
} from '@/lib/db'

import { EMBEDDER_INTEGRATIONS } from './integrations'
import { l2Normalize } from './local/pooling'
import { embedLocal } from './local/runtime'
import { EmbedderCallError, EmbedderInitError, type EmbedderConfig } from './types'

export type EmbedIntent = 'document' | 'query'

type RawEmbedding = { vectors: Float32Array[]; dim: number }

function localPrefix(modelId: string, intent: EmbedIntent): string {
  const integration = EMBEDDER_INTEGRATIONS[modelId]
  // Falling back to '' would embed a prefix-sensitive model prefix-free: the
  // vectors look valid, land with a fresh source_hash, and quietly degrade
  // retrieval forever. Refuse instead.
  if (integration === undefined) {
    throw new EmbedderInitError(`No embedder integration registered for model "${modelId}"`)
  }
  return intent === 'query' ? integration.queryPrefix : integration.documentPrefix
}

async function embedRaw(
  config: EmbedderConfig,
  texts: string[],
  intent: EmbedIntent,
  provider: ProviderInstanceWithStub | undefined,
): Promise<RawEmbedding> {
  if (config.backend === 'local') {
    const prefix = localPrefix(config.modelId, intent)
    const prefixed = prefix === '' ? texts : texts.map((text) => prefix + text)
    return embedLocal(config.modelId, prefixed)
  }

  if (provider === undefined) {
    throw new EmbedderInitError('provider instance not supplied')
  }
  // Lazy so importing the embedder barrel (reachable from config-presence checks)
  // never pulls the AI SDK into module-eval; provider embedding is v1 prefix-free.
  const { embedViaProvider } = await import('@/lib/ai')
  const dimensions =
    config.truncation?.serverSide === true ? config.truncation.effectiveDim : undefined
  return embedViaProvider(provider, config.modelId, texts, undefined, dimensions)
}

/**
 * Embed `texts` and return unit-norm vectors at the model's native dim, or at
 * `config.truncation.effectiveDim` (provider Matryoshka) when set.
 *
 * Every returned vector is L2-normalized here so vec0's L2 KNN stays
 * rank-equivalent to cosine — truncation runs before normalization, so a
 * Matryoshka-truncated vector is still unit-norm. Local vectors arrive
 * unit-norm and pass the idempotent guard untouched; provider vectors are
 * normalized as needed.
 *
 * `intent` selects the local model's document/query prefix (provider backends
 * are prefix-free in v1). `provider` is required for provider-backend configs
 * (the facade stays store-free) and throws EmbedderInitError when missing.
 *
 * Dim reconciliation is the CALLER's job: `config.dim` must already be the
 * effective NATIVE dim (resolve-config threads `providerDim`). A provider
 * `dim` of `null` means not yet probed, so the returned dim is accepted as-is
 * before any Matryoshka truncation is applied on top.
 */
export async function embedTexts(
  config: EmbedderConfig,
  texts: string[],
  intent: EmbedIntent = 'document',
  provider?: ProviderInstanceWithStub,
): Promise<{ vectors: Float32Array[]; dim: number }> {
  if (texts.length === 0) return { vectors: [], dim: 0 }

  const raw = await embedRaw(config, texts, intent, provider)

  // A malformed provider response with the wrong vector count would silently
  // misalign vectors onto rows downstream — reject it before that can happen.
  if (raw.vectors.length !== texts.length) {
    throw new EmbedderCallError(
      `embedding count mismatch: expected ${texts.length} vectors, got ${raw.vectors.length}`,
    )
  }

  // A local config always knows its dim, so this can't be skipped for local.
  // A provider that was sent `dimensions` may legitimately return either the
  // native dim (param ignored) or effectiveDim (param honored) — the server's
  // compliance isn't guaranteed, so both are accepted only when the param was
  // actually sent; any other value is still rejected.
  const truncation = config.backend === 'provider' ? config.truncation : null
  const dimOk =
    config.dim === null ||
    raw.dim === config.dim ||
    (truncation?.serverSide === true && raw.dim === truncation.effectiveDim)
  if (!dimOk) {
    throw new EmbedderCallError(`embedding dim mismatch: expected ${config.dim}, got ${raw.dim}`)
  }

  // Matryoshka: truncate to the story's effective dim BEFORE normalization —
  // cosine on truncated vectors requires re-norm. Clamped to the native dim so
  // an over-declared custom dim degrades to a no-op instead of lying about N.
  const targetDim = truncation != null ? Math.min(truncation.effectiveDim, raw.dim) : raw.dim
  // .slice (not .subarray): l2Normalize may return its input untouched, and
  // packFloat32 packs the backing view — a shared view is a latent packing hazard.
  const vectors = raw.vectors.map((vector) =>
    l2Normalize(targetDim < vector.length ? vector.slice(0, targetDim) : vector),
  )

  return { vectors, dim: targetDim }
}

/**
 * Embed each row's composite text and return ready-to-batch SqlOps: a vec0 upsert
 * plus an `embedding_stale = 0` clear per row. The dim's vec tables are ensured
 * first through `exec` (DDL can't run inside the atomic ops batch); the RETURNED
 * dim drives both the ensure and the ops, so an unprobed provider still targets
 * the correct dim family.
 *
 * The returned per-row `embedding_stale = 0` UPDATE assumes the source row
 * already exists — either it pre-exists, or the caller splices these ops AFTER
 * the source-row INSERTs in the same atomic batch.
 *
 * `provider` is required for provider-backend configs (see embedTexts).
 */
export async function embedAndBuildVecOps(
  config: EmbedderConfig,
  rows: EmbeddedFieldRow[],
  exec: (sql: string) => Promise<void>,
  provider?: ProviderInstanceWithStub,
): Promise<SqlOp[]> {
  return (await embedRowsToVecOps(config, rows, exec, provider)).ops
}

/**
 * As `embedAndBuildVecOps`, but also reports the dim the vectors were written at.
 * A swap needs it: the served dim can differ from the declared one (clamped to
 * native), and phase 2 must know which family it staged into before deleting the
 * story's other rows under the same model id. `dim` is null when nothing embedded.
 */
export async function embedRowsToVecOps(
  config: EmbedderConfig,
  rows: EmbeddedFieldRow[],
  exec: (sql: string) => Promise<void>,
  provider?: ProviderInstanceWithStub,
): Promise<{ ops: SqlOp[]; dim: number | null }> {
  if (rows.length === 0) return { ops: [], dim: null }

  const composites = rows.map((row) => compositeText(row.fields))
  const { vectors, dim } = await embedTexts(config, composites, 'document', provider)

  try {
    await ensureVecTables(dim, exec)
  } catch (error) {
    // Surface DDL failures as a typed call error so the wizard's Finish catch
    // renders the graceful failure surface instead of a raw exec rejection.
    const message = error instanceof Error ? error.message : String(error)
    throw new EmbedderCallError(`vec table ensure failed: ${message}`, error)
  }

  const ops: SqlOp[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    ops.push(
      ...upsertVecOps({
        kind: row.kind,
        id: row.id,
        branchId: row.branchId,
        modelId: config.modelId,
        dim,
        sourceHash: sourceHash(composites[i]),
        vector: packFloat32(vectors[i]),
      }),
      clearEmbeddingStaleOp(row.kind, row.id, row.branchId),
    )
  }
  return { ops, dim }
}

/**
 * Probe the configured embedder with one short string, catching typed failures
 * into a result union — never throws. `provider` is required for provider
 * configs (see embedTexts).
 */
export async function testEmbedder(
  config: EmbedderConfig,
  provider?: ProviderInstanceWithStub,
): Promise<
  { ok: true; dim: number; ms: number } | { ok: false; kind: 'init' | 'call'; message: string }
> {
  const start = Date.now()
  try {
    const { dim } = await embedTexts(config, ['embedder health check'], 'document', provider)
    return { ok: true, dim, ms: Date.now() - start }
  } catch (error) {
    if (error instanceof EmbedderInitError || error instanceof EmbedderCallError) {
      return { ok: false, kind: error.kind, message: error.message }
    }
    return {
      ok: false,
      kind: 'init',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
