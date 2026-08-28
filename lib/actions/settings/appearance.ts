import { eq } from 'drizzle-orm'

import { APP_SETTINGS_SINGLETON_ID, appSettings } from '@/lib/db'
import { rehydrateAppSettings } from '@/lib/stores'

import { jsonMergeObject } from './json-write'
import type { DbCtx } from '../types'

export async function setAppearanceThemeId(themeId: string, ctx: DbCtx): Promise<void> {
  await ctx.runInTransaction([
    ctx.db
      .update(appSettings)
      .set({ appearance: jsonMergeObject(appSettings.appearance, { themeId }) })
      .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
      .toSQL(),
  ])
  await rehydrateAppSettings(ctx.db)
}
