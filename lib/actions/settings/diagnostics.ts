import { eq } from 'drizzle-orm'

import { APP_SETTINGS_SINGLETON_ID, type AppSettingsDiagnostics, appSettings } from '@/lib/db'
import { clearBuffers } from '@/lib/diagnostics'
import { rehydrateAppSettings } from '@/lib/stores'

import { jsonMergeObject } from './json-write'
import type { DbCtx } from '../types'

async function persist(ctx: DbCtx, patch: Partial<AppSettingsDiagnostics>): Promise<void> {
  await ctx.runInTransaction([
    ctx.db
      .update(appSettings)
      .set({ diagnostics: jsonMergeObject(appSettings.diagnostics, patch) })
      .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
      .toSQL(),
  ])
  await rehydrateAppSettings(ctx.db)
}

export async function setDiagnosticsEnabled(value: boolean, ctx: DbCtx): Promise<void> {
  await persist(ctx, { enabled: value })
  if (!value) clearBuffers()
}

export async function setDebugLevelEnabled(value: boolean, ctx: DbCtx): Promise<void> {
  await persist(ctx, { debug_level_enabled: value })
}
