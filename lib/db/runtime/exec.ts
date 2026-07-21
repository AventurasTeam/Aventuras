import { bridgeQuery, resolveBridge } from './bridge'

// Raw DDL seam: vec0 CREATE VIRTUAL TABLE can't run inside the atomic ops-batch
// RPC (one serialized BEGIN..COMMIT per transaction()), so lazily-created dim
// families go through the bridge's dedicated exec channel instead.
export async function execRaw(sql: string): Promise<void> {
  await resolveBridge().exec(sql)
}

// Table-name discovery seam (see exec.native.ts for the counterpart). The two
// drivers disagree on row shape — sqlite-proxy hands back arrays-of-values
// indexed by column position, expo-sqlite hands back objects — so the shape is
// unwrapped per platform here rather than guessed at the call site.
export async function listTableNames(): Promise<string[]> {
  const result = await bridgeQuery("SELECT name FROM sqlite_master WHERE type = 'table'", [], 'all')
  return (result.rows as unknown[][]).map((row) => String(row[0]))
}
