import type { Delta } from '@/lib/db'

export const entityRowLockKey = (branchId: string, id: string) => `entities:${branchId}:${id}`

// Per branch, not per pair: a delete names a row id, not a pair.
export const relationshipsLockKey = (branchId: string) => `character_relationships:${branchId}`

const KEY_BY_TABLE = new Map<string, (d: Delta) => string>([
  ['entities', (d) => entityRowLockKey(d.branchId, d.targetId)],
  ['character_relationships', (d) => relationshipsLockKey(d.branchId)],
])

/** The keys that serialize writes to the rows `rows` target, so a reversal can't straddle a Save. */
export function deltaLockKeys(rows: readonly Delta[]): string[] {
  return rows.flatMap((d) => {
    const key = KEY_BY_TABLE.get(d.targetTable)
    return key ? [key(d)] : []
  })
}
