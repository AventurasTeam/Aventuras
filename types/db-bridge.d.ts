// types/db-bridge.d.ts — renderer + global Window augmentation.
// (Electron main/preload get their own copy in electron/db/types.ts — the two
// compile units are separate tsconfigs, so the small duplication is intentional.)
export type DbProxyMethod = 'run' | 'all' | 'values' | 'get'
export type DbProxyResult = { rows: unknown[] }
export type DbProxyQuery = { sql: string; params: unknown[]; method: DbProxyMethod }

export type DbBridge = {
  query(sql: string, params: unknown[], method: DbProxyMethod): Promise<DbProxyResult>
  exec(sql: string): Promise<void>
  transaction(ops: { sql: string; params: unknown[] }[]): Promise<{ ok: true }>
  /** Every query in one synchronous call on the one connection; results in query order. */
  batch(queries: DbProxyQuery[]): Promise<DbProxyResult[]>
}

declare global {
  interface Window {
    aventurasDb?: DbBridge
  }
}

export {}
