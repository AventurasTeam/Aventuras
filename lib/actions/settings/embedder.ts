import { eq } from 'drizzle-orm'

import { APP_SETTINGS_SINGLETON_ID, appSettings } from '@/lib/db'
import { testEmbedder } from '@/lib/embedder'
import { appSettingsStore, rehydrateAppSettings } from '@/lib/stores'

import type { DbCtx } from '../types'
import { recordProviderEmbeddingDim } from './providers'

export type ProviderEmbeddingDimInput = { providerId: string; modelId: string }
export type ProviderEmbeddingDimResult = Awaited<ReturnType<typeof testEmbedder>>
export type RunEmbedderProbe = typeof testEmbedder

const pendingDimensionProbes = new Map<string, Promise<ProviderEmbeddingDimResult>>()

export async function setEmbedderDefaults(
  input: { backend: 'local' | 'provider'; modelId: string | null; providerId: string | null },
  ctx: DbCtx,
): Promise<void> {
  // Fresh select, not the store cache: a read-modify-write off a stale
  // in-memory defaultStorySettings would clobber sibling keys. Mirrors
  // setAppearanceThemeId's fresh-select pattern.
  const [row] = await ctx.db
    .select({ defaultStorySettings: appSettings.defaultStorySettings })
    .from(appSettings)
    .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
  const currentDefaults = row?.defaultStorySettings ?? {}

  await ctx.db
    .update(appSettings)
    .set({
      embeddingModelId: input.modelId,
      embeddingProviderId: input.backend === 'provider' ? input.providerId : null,
      defaultStorySettings: { ...currentDefaults, embeddingBackend: input.backend },
    })
    .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))

  const result = await rehydrateAppSettings(ctx.db)
  if (result.status !== 'ok') {
    throw new Error(`Failed to rehydrate app settings: ${result.error}`)
  }
}

export async function probeProviderEmbeddingDim(
  input: ProviderEmbeddingDimInput,
  ctx: DbCtx,
  runTest: RunEmbedderProbe = testEmbedder,
): Promise<ProviderEmbeddingDimResult> {
  const provider = appSettingsStore
    .getAppSettings()
    .providers.find((candidate) => candidate.id === input.providerId)
  if (provider == null) {
    return { ok: false, kind: 'init', message: `Provider ${input.providerId} is not configured` }
  }

  const result = await runTest(
    {
      backend: 'provider',
      providerId: input.providerId,
      modelId: input.modelId,
      dim: null,
      truncation: null,
    },
    provider,
  )
  if (result.ok) {
    await recordProviderEmbeddingDim(input.providerId, input.modelId, result.dim, ctx)
  }
  return result
}

export async function ensureProviderEmbeddingDim(
  input: ProviderEmbeddingDimInput,
  ctx: DbCtx,
  runTest: RunEmbedderProbe = testEmbedder,
): Promise<ProviderEmbeddingDimResult> {
  const cached = appSettingsStore
    .getAppSettings()
    .providers.find((provider) => provider.id === input.providerId)
    ?.cachedModels?.find((model) => model.id === input.modelId)?.capabilities?.embeddingDim
  if (cached != null) return { ok: true, dim: cached, ms: 0 }

  const key = `${input.providerId}:${input.modelId}`
  const active = pendingDimensionProbes.get(key)
  if (active != null) return active

  const probe = probeProviderEmbeddingDim(input, ctx, runTest).finally(() => {
    pendingDimensionProbes.delete(key)
  })
  pendingDimensionProbes.set(key, probe)
  return probe
}
