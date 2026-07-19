import { eq } from 'drizzle-orm'

import { APP_SETTINGS_SINGLETON_ID, appSettings } from '@/lib/db'
import { appSettingsStore, rehydrateAppSettings } from '@/lib/stores'

import type { SettingsActionCtx } from './types'

export async function setAppearanceThemeId(themeId: string, ctx: SettingsActionCtx): Promise<void> {
  const current = appSettingsStore.getAppSettings().appearance
  await ctx.db
    .update(appSettings)
    .set({ appearance: { ...current, themeId } })
    .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
  await rehydrateAppSettings(ctx.db)
}
