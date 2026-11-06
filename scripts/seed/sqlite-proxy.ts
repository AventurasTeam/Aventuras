import type { DatabaseSync } from 'node:sqlite'

// node:sqlite returns row objects; sqlite-proxy needs positional arrays. 'get'
// returns the single row directly. Identical to electron/db/service.ts.
export function makeProxy(sqlite: DatabaseSync) {
  return async (sql: string, params: unknown[], method: 'run' | 'all' | 'get' | 'values') => {
    const stmt = sqlite.prepare(sql)
    if (method === 'run') {
      stmt.run(...(params as never[]))
      return { rows: [] }
    }
    const raw = stmt.all(...(params as never[])) as Record<string, unknown>[]
    const asArrays = raw.map((r) => Object.values(r))
    return { rows: (method === 'get' ? asArrays[0] : asArrays) as unknown[] }
  }
}
