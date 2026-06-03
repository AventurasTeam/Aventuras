import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator'

import { db } from './client.native'
import migrations from '../migrations/migrations'

export function useDbMigrations(): { success: boolean; error?: Error } {
  return useMigrations(db, migrations)
}
