import { eq } from 'drizzle-orm'

import { APP_SETTINGS_SINGLETON_ID, type AppSettingsDiagnostics, appSettings } from '@/lib/db'
import { clearBuffers } from '@/lib/diagnostics'
import { appSettingsStore, rehydrateAppSettings } from '@/lib/stores'

import type { DbCtx } from '../types'

async function persist(ctx: DbCtx, next: AppSettingsDiagnostics): Promise<void> {
  await ctx.db
    .update(appSettings)
    .set({ diagnostics: next })
    .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
  await rehydrateAppSettings(ctx.db)
}

export async function setDiagnosticsEnabled(value: boolean, ctx: DbCtx): Promise<void> {
  const current = appSettingsStore.getAppSettings().diagnostics
  await persist(ctx, { ...current, enabled: value })
  if (!value) clearBuffers()
}

export async function setDebugLevelEnabled(value: boolean, ctx: DbCtx): Promise<void> {
  const current = appSettingsStore.getAppSettings().diagnostics
  await persist(ctx, { ...current, debug_level_enabled: value })
}
