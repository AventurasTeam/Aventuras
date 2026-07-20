import { eq } from 'drizzle-orm'

import { APP_SETTINGS_SINGLETON_ID, appSettings } from '@/lib/db'
import { rehydrateAppSettings } from '@/lib/stores'

import type { SettingsActionCtx } from './types'

export async function setEmbedderDefaults(
  input: { backend: 'local' | 'provider'; modelId: string | null; providerId: string | null },
  ctx: SettingsActionCtx,
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
