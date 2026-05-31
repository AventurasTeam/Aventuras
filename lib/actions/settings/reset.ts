import { eq } from 'drizzle-orm'

import { APP_SETTINGS_DEFAULTS, APP_SETTINGS_SINGLETON_ID, appSettings } from '@/lib/db'
import { type BootHydrateResult, rehydrateAppSettings } from '@/lib/stores'

import type { SettingsActionCtx } from './types'

// Boot-recovery action: overwrite the singleton's config + diagnostics columns
// with defaults (the corrupt row already exists), then re-hydrate. Destructive
// to providers/keys — only ever invoked from the recovery screen's explicit
// Reset, never automatically.
export async function resetAppSettings(ctx: SettingsActionCtx): Promise<BootHydrateResult> {
  await ctx.db
    .update(appSettings)
    .set({ ...APP_SETTINGS_DEFAULTS })
    .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
  return rehydrateAppSettings(ctx.db)
}
