import { eq, sql } from 'drizzle-orm'

import { idleStatus } from '@/lib/classifier'
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

/** Highest `story_entries.position` on the branch — the cadence's unprocessed-count input. */
export async function headPosition(branchId: string, ctx: DbCtx): Promise<number> {
  const [row] = await ctx.db
    .select({ maxPosition: sql<number | null>`MAX(${storyEntries.position})` })
    .from(storyEntries)
    .where(eq(storyEntries.branchId, branchId))
  return row?.maxPosition ?? 0
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
 * Boot-time orphan reconciliation: a branch left `state: 'running'` was owned
 * by a process that no longer exists, so nothing is actually in flight for it.
 * Key-scoped `$.state` only — `processedThrough` (the watermark never
 * advanced, which is the coherent matching state) and the retry lifecycle keys
 * are untouched, and this must never fire for 'retrying' / 'failed-persistent'
 * (a real error the manual run — not boot — is meant to surface and clear).
 */
export async function resetStuckClassifierRunState(ctx: DbCtx): Promise<void> {
  await ctx.db.run(
    sql`UPDATE ${branches}
        SET classifier_status = json_set(classifier_status, '$.state', 'idle')
        WHERE json_extract(classifier_status, '$.state') = 'running'`,
  )
}
