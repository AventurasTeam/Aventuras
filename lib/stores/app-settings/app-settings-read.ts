import { eq } from 'drizzle-orm'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'

import { APP_SETTINGS_SINGLETON_ID, appSettings as appSettingsTable, db } from '@/lib/db'

import { type BootHydrateResult, hydrateAppSettings } from './app-settings'

type AnyDb = BaseSQLiteDatabase<'sync' | 'async', unknown, Record<string, unknown>>

async function readAppSettingsRow(database: AnyDb = db): Promise<unknown> {
  const rows = await database
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.id, APP_SETTINGS_SINGLETON_ID))
  return rows[0]
}

export function rehydrateAppSettings(database: AnyDb = db): Promise<BootHydrateResult> {
  return hydrateAppSettings(() => readAppSettingsRow(database))
}
