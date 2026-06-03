import type { SQLiteVariadicBindParams } from 'expo-sqlite'

import { expoDb } from './client.native'
import type { SqlOp } from '../types'

// Native: expo withTransactionSync runs BEGIN/COMMIT (rolls back on throw).
export async function runInTransaction(ops: SqlOp[]): Promise<void> {
  expoDb.withTransactionSync(() => {
    for (const op of ops) {
      expoDb.runSync(op.sql, ...(op.params as SQLiteVariadicBindParams))
    }
  })
}

export type { SqlOp }
