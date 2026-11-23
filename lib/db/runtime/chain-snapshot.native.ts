import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite'

import {
  chainSnapshotQueries,
  type ChainSnapshot,
  type ChainSnapshotArgs,
} from './chain-snapshot-queries'
import type { dbSchema } from '../schema'
import type { DbCtx, Delta } from '../types'

/** The chain and the row with no write committed between them. */
export async function readChainSnapshot(
  db: DbCtx['db'],
  args: ChainSnapshotArgs,
): Promise<ChainSnapshot> {
  const local = db as ExpoSQLiteDatabase<typeof dbSchema>
  const queries = chainSnapshotQueries(local, args)
  // Two sync reads, no await between: no write runs between them on the JS thread, while
  // nothing calls expo-sqlite's async API (eslint.config.js bans it).
  const chain = queries.chain.all() as Delta[]
  const rows = queries.row.all() as Record<string, unknown>[]
  return { chain, row: rows[0] ?? null }
}
