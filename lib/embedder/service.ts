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
  if (integration === undefined) return ''
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
  return embedViaProvider(provider, config.modelId, texts)
}

/**
 * Embed `texts` and return unit-norm vectors at the model's native dim.
 *
 * Every returned vector is L2-normalized here so vec0's L2 KNN stays
 * rank-equivalent to cosine. Local vectors arrive unit-norm and pass the
 * idempotent guard untouched; provider vectors are normalized as needed.
 *
 * `intent` selects the local model's document/query prefix (provider backends
 * are prefix-free in v1). `provider` is required for provider-backend configs
 * (the facade stays store-free) and throws EmbedderInitError when missing.
 *
 * Dim reconciliation is the CALLER's job: `config.dim` must already be the
 * effective dim (resolve-config threads `providerDim`). A `config.dim` of 0 is
 * the not-yet-probed provider sentinel — the returned dim is accepted as-is.
 */
export async function embedTexts(
  config: EmbedderConfig,
  texts: string[],
  intent: EmbedIntent = 'document',
  provider?: ProviderInstanceWithStub,
): Promise<{ vectors: Float32Array[]; dim: number }> {
  if (texts.length === 0) return { vectors: [], dim: 0 }

  const raw = await embedRaw(config, texts, intent, provider)

  // Single funnel for every vector — the post-embed transform point where 3.1b's
  // Matryoshka truncation composes ahead of normalization.
  const vectors = raw.vectors.map((vector) => l2Normalize(vector))

  if (config.dim > 0 && raw.dim !== config.dim) {
    throw new EmbedderCallError(`embedding dim mismatch: expected ${config.dim}, got ${raw.dim}`)
  }

  return { vectors, dim: raw.dim }
}

/**
 * Embed each row's composite text and return ready-to-batch SqlOps: a vec0 upsert
 * plus an `embedding_stale = 0` clear per row. The dim's vec tables are ensured
 * first through `exec` (DDL can't run inside the atomic ops batch); the RETURNED
 * dim drives both the ensure and the ops, so an unprobed provider (config.dim 0)
 * still targets the correct dim family.
 *
 * `provider` is required for provider-backend configs (see embedTexts).
 */
export async function embedAndBuildVecOps(
  config: EmbedderConfig,
  rows: EmbeddedFieldRow[],
  exec: (sql: string) => Promise<void>,
  provider?: ProviderInstanceWithStub,
): Promise<SqlOp[]> {
  if (rows.length === 0) return []

  const composites = rows.map((row) => compositeText(row.fields))
  const { vectors, dim } = await embedTexts(config, composites, 'document', provider)

  await ensureVecTables(dim, exec)

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
  return ops
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
