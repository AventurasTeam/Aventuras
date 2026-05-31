import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'

export type SettingsActionCtx = {
  db: BaseSQLiteDatabase<'sync' | 'async', unknown, Record<string, unknown>>
}
