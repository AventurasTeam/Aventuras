import { resolveBridge } from './bridge'
import type { SqlOp } from '../types'

// Desktop/web: serialize the whole BEGIN/COMMIT to the Electron main process in
// one IPC so it can't interleave with a concurrent run on the shared connection.
export async function runInTransaction(ops: SqlOp[]): Promise<void> {
  // Op builders legitimately return nothing; an empty BEGIN/COMMIT is inert.
  if (ops.length === 0) return
  await resolveBridge().transaction(ops)
}

export type { SqlOp }
