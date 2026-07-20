import { eq } from 'drizzle-orm'

import { APP_SETTINGS_SINGLETON_ID, appSettings } from '@/lib/db'
import { appSettingsStore, rehydrateAppSettings } from '@/lib/stores'

import type { SettingsActionCtx } from './types'

export async function setAppearanceThemeId(themeId: string, ctx: SettingsActionCtx): Promise<void> {
  // Read the row, not the store cache: a read-modify-write off a stale in-memory
  // appearance (e.g. store not yet rehydrated after another write) would clobber
  // sibling keys. Mirrors normalizeAppSettingsRow's fresh-select pattern.
  const [row] = await ctx.db
    .select({ appearance: appSettings.appearance })
    .from(appSettings)
    .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
  const current = row?.appearance ?? appSettingsStore.getAppSettings().appearance
  await ctx.db
    .update(appSettings)
    .set({ appearance: { ...current, themeId } })
    .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
  await rehydrateAppSettings(ctx.db)
}
