import { drizzle } from 'drizzle-orm/sqlite-proxy'

import { bridgeQuery } from './bridge'
import { dbSchema } from '../schema'

// Desktop (Electron renderer) + any web target: queries are serialized to the
// Electron main process, which owns node:sqlite + sqlite-vec.
export const db = drizzle(async (sqlText, params, method) => bridgeQuery(sqlText, params, method), {
  schema: dbSchema,
})
