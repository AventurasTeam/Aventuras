import { drizzle } from 'drizzle-orm/expo-sqlite'
import { bundledExtensions, openDatabaseSync } from 'expo-sqlite'

import { dbSchema } from '../schema'

export const expoDb = openDatabaseSync('aventuras.db')
expoDb.execSync('PRAGMA foreign_keys = ON;')

// sqlite-vec at client init. Migration 0005 creates vec0 virtual tables, so a
// failed load still fails migrations below — this only turns it into an
// earlier, clearer warning first.
try {
  const ext = bundledExtensions['sqlite-vec']
  if (!ext) {
    throw new Error('sqlite-vec not bundled (enable withSQLiteVecExtension)')
  }
  expoDb.loadExtensionSync(ext.libPath, ext.entryPoint)
} catch (err) {
  // eslint-disable-next-line no-console -- boot-time DB-init warning; fires before the diagnostics gate hydrates and there is no 'db' LogSubsystem, so the logger is the wrong channel.
  console.warn('sqlite-vec load failed (non-fatal in M1):', err)
}

export const db = drizzle(expoDb, { schema: dbSchema })
