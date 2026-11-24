import { drizzle } from 'drizzle-orm/sqlite-proxy'

import { bridgeBatch, bridgeQuery } from './bridge'
import { dbSchema } from '../schema'

// Desktop (Electron renderer) + any web target: queries are serialized to the
// Electron main process, which owns node:sqlite + sqlite-vec. A batch crosses as
// one IPC call, so main runs its queries with no write between them.
export const db = drizzle(
  async (sqlText, params, method) => bridgeQuery(sqlText, params, method),
  async (queries) => bridgeBatch(queries),
  { schema: dbSchema },
)
