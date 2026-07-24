import type { SQLiteVariadicBindParams } from 'expo-sqlite'

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

// Positional value-array query seam (see exec.ts): expo-sqlite returns objects,
// so each row is normalized to a values-array in the SELECT's column order to
// match the sqlite-proxy shape the embedder-swap engine's `queryAll` expects.
export async function queryRows(sql: string, params: unknown[]): Promise<unknown[][]> {
  const rows = expoDb.getAllSync<Record<string, unknown>>(
    sql,
    ...(params as SQLiteVariadicBindParams),
  )
  return rows.map((row) => Object.values(row))
}
