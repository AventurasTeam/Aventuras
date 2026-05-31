import { eq } from 'drizzle-orm'

import { APP_SETTINGS_SINGLETON_ID, type AppSettingsDiagnostics, appSettings } from '@/lib/db'
import { clearBuffers } from '@/lib/diagnostics'
import { domain, rehydrateAppSettings } from '@/lib/stores'

import type { SettingsActionCtx } from './types'

// Persist a merged diagnostics object, then re-hydrate the mirror from SQLite
// (canonical). The current value comes from the hydrated store — the action's
// only caller is the settings UI, where the store is live post-boot.
async function persist(ctx: SettingsActionCtx, next: AppSettingsDiagnostics): Promise<void> {
  await ctx.db
    .update(appSettings)
    .set({ diagnostics: next })
    .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
  await rehydrateAppSettings(ctx.db)
}

export async function setDiagnosticsEnabled(value: boolean, ctx: SettingsActionCtx): Promise<void> {
  const current = domain.getAppSettings().diagnostics
  await persist(ctx, { ...current, enabled: value })
  if (!value) clearBuffers()
}

export async function setDebugLevelEnabled(value: boolean, ctx: SettingsActionCtx): Promise<void> {
  const current = domain.getAppSettings().diagnostics
  await persist(ctx, { ...current, debug_level_enabled: value })
}
