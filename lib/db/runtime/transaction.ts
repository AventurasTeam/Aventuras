import { resolveBridge } from './bridge'
import type { SqlOp } from '../types'

// Desktop/web: serialize the whole BEGIN/COMMIT to the Electron main process in
// one IPC so it can't interleave with a concurrent run on the shared connection.
export async function runInTransaction(ops: SqlOp[]): Promise<void> {
  await resolveBridge().transaction(ops)
}

export type { SqlOp }
