import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'

import {
  chainSnapshotQueries,
  type ChainSnapshot,
  type ChainSnapshotArgs,
} from './chain-snapshot-queries'
import type { dbSchema } from '../schema'
import type { DbCtx, Delta } from '../types'

/** The chain and the row with no write committed between them: one batch over the proxy. */
export async function readChainSnapshot(
  db: DbCtx['db'],
  args: ChainSnapshotArgs,
): Promise<ChainSnapshot> {
  const remote = db as SqliteRemoteDatabase<typeof dbSchema>
  const queries = chainSnapshotQueries(remote, args)
  const [chain, rows] = await remote.batch([queries.chain, queries.row])
  return {
    chain: chain as Delta[],
    row: (rows[0] as Record<string, unknown> | undefined) ?? null,
  }
}
