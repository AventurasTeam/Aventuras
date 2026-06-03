import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'

import type { ModelProfile, ProviderInstance } from './app-settings-schema'
import { appSettings } from '../schema'

export const APP_SETTINGS_SINGLETON_ID = 'singleton'

export const APP_SETTINGS_DEFAULTS = {
  providers: [] as ProviderInstance[],
  profiles: [] as ModelProfile[],
  assignments: {} as Record<string, string>,
  defaultProviderId: null as string | null,
  diagnostics: { enabled: false, debug_level_enabled: false },
}

// onConflictDoNothing() on the id PK makes this safe to call repeatedly.
export async function ensureAppSettingsSingleton<
  T extends BaseSQLiteDatabase<'sync' | 'async', unknown, Record<string, unknown>>,
>(db: T): Promise<void> {
  await db
    .insert(appSettings)
    .values({ id: APP_SETTINGS_SINGLETON_ID, ...APP_SETTINGS_DEFAULTS })
    .onConflictDoNothing()
}
