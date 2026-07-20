import { resolveBridge } from './bridge'

// Raw DDL seam: vec0 CREATE VIRTUAL TABLE can't run inside the atomic ops-batch
// RPC (one serialized BEGIN..COMMIT per transaction()), so lazily-created dim
// families go through the bridge's dedicated exec channel instead.
export async function execRaw(sql: string): Promise<void> {
  await resolveBridge().exec(sql)
}
