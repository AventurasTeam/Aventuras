import { expoDb } from './client.native'

// Raw DDL seam (see exec.ts): expoDb.execSync runs statements outside the atomic
// ops batch, wrapped async to share the web signature.
export async function execRaw(sql: string): Promise<void> {
  expoDb.execSync(sql)
}

// Table-name discovery seam (see exec.ts): expo-sqlite returns rows as objects,
// unlike the proxy's arrays-of-values.
export async function listTableNames(): Promise<string[]> {
  const rows = expoDb.getAllSync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  )
  return rows.map((row) => row.name)
}
