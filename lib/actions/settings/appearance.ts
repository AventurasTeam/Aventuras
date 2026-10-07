import { eq } from 'drizzle-orm'

import { APP_SETTINGS_SINGLETON_ID, appSettings, type Appearance } from '@/lib/db'
import { rehydrateAppSettings } from '@/lib/stores'

import { jsonMergeObject } from './json-write'
import type { DbCtx } from '../types'

async function mergeAppearance(patch: Partial<Appearance>, ctx: DbCtx): Promise<void> {
  await ctx.runInTransaction([
    ctx.db
      .update(appSettings)
      .set({ appearance: jsonMergeObject(appSettings.appearance, patch) })
      .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
      .toSQL(),
  ])
  await rehydrateAppSettings(ctx.db)
}

export async function setAppearanceThemeId(themeId: string, ctx: DbCtx): Promise<void> {
  await mergeAppearance({ themeId }, ctx)
}

/**
 * Rejects when the write fails, with the store unchanged; resolves with the store stale when the
 * write lands but its re-hydrate reports config-corrupt.
 */
export async function setReaderRailCollapsed(collapsed: boolean, ctx: DbCtx): Promise<void> {
  await mergeAppearance({ readerRailCollapsed: collapsed }, ctx)
}
