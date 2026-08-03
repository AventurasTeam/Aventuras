import { and, eq, gt, ne, sql } from 'drizzle-orm'

import { IDLE_STATUS_JSON, idleStatus, nextStatusOnFailure } from '@/lib/classifier'
import { branches, storyEntries, type ClassifierStatus, type DbCtx } from '@/lib/db'
import { embedTexts, type EmbedderConfig } from '@/lib/embedder'
import { appSettingsStore, currentStoryStore } from '@/lib/stores'

import { resolveDrainConfig } from '../embedder-swap'

/**
 * Transient decision-time embed for disambiguation — NOT a persisted embedding
 * write, so it sits outside the embedding-compute boundary (classifier.md).
 */
export async function embedClassifierDescriptions(
  texts: string[],
): Promise<{ vectors: Float32Array[]; dim: number }> {
  const storyId = currentStoryStore.getCurrentStory()?.storyId
  if (storyId == null) return { vectors: [], dim: 0 }
  const resolution = resolveDrainConfig(storyId)
  if (!resolution.ok) return { vectors: [], dim: 0 }
  const config: EmbedderConfig = resolution.config
  const provider =
    config.backend === 'provider'
      ? appSettingsStore.getAppSettings().providers.find((p) => p.id === config.providerId)
      : undefined
  return embedTexts(config, texts, 'document', provider)
}

/**
 * Classifiable turns past the watermark — the cadence's input. Counts rows rather
 * than differencing positions: `system` entries occupy positions but are filtered
 * out of the window, so a position delta fires the cadence early on a branch that
 * carries technical rows.
 */
export async function unprocessedTurnCount(
  branchId: string,
  processedThrough: number | null,
  ctx: DbCtx,
): Promise<number> {
  const [row] = await ctx.db
    .select({ n: sql<number>`COUNT(*)` })
    .from(storyEntries)
    .where(
      and(
        eq(storyEntries.branchId, branchId),
        gt(storyEntries.position, processedThrough ?? 0),
        ne(storyEntries.kind, 'system'),
      ),
    )
  return row?.n ?? 0
}

export async function readClassifierStatus(
  branchId: string,
  ctx: DbCtx,
): Promise<ClassifierStatus> {
  const [row] = await ctx.db
    .select({ classifierStatus: branches.classifierStatus })
    .from(branches)
    .where(eq(branches.id, branchId))
  return row?.classifierStatus ?? idleStatus()
}

/**
 * Records a failure the classifier phase never saw. A pre-flight failure (an
 * unassigned `classifier` agent) halts the run before phase 0, so without this the
 * status stays idle: no backoff, no failed-persistent, no `lastError` for the pill,
 * and the cadence re-fires the doomed run on every committed turn.
 */
export async function recordClassifierPreflightFailure(
  branchId: string,
  detail: string,
  ctx: DbCtx,
): Promise<void> {
  const current = await readClassifierStatus(branchId, ctx)
  const { status } = nextStatusOnFailure(current, { error: detail, at: Date.now() })
  await ctx.db.run(
    sql`UPDATE ${branches} SET classifier_status = json_set(
          COALESCE(classifier_status, ${IDLE_STATUS_JSON}),
          '$.state', ${status.state},
          '$.lastError', ${status.lastError},
          '$.retryCount', ${status.retryCount}
        ) WHERE ${branches.id} = ${branchId}`,
  )
}

/**
 * Boot-time orphan reconciliation: a branch left `state: 'running'` was owned by a
 * process that no longer exists. Scoped to `$.state` and to 'running' only —
 * 'retrying' / 'failed-persistent' are real errors the manual run must surface.
 */
export async function resetStuckClassifierRunState(ctx: DbCtx): Promise<void> {
  await ctx.db.run(
    sql`UPDATE ${branches}
        SET classifier_status = json_set(classifier_status, '$.state', 'idle')
        WHERE json_extract(classifier_status, '$.state') = 'running'`,
  )
}
