import type { SyncEntityType, SyncVector } from '#lib/types/sync.ts'

export interface SqlStatement {
  sql: string
  params?: unknown[]
}

/** Gives an item an identity and this device's first edit, unless it already has one. */
export function ensureIdentityStatements(
  entityType: SyncEntityType,
  localId: string,
  syncId: string,
  selfId: string,
): SqlStatement[] {
  return [
    {
      sql: 'INSERT OR IGNORE INTO sync_identity (entity_type, local_id, sync_id) VALUES (?, ?, ?)',
      params: [entityType, localId, syncId],
    },
    {
      sql: `INSERT OR IGNORE INTO sync_vector (sync_id, device_id, counter)
            SELECT sync_id, ?, 1 FROM sync_identity WHERE entity_type = ? AND local_id = ?`,
      params: [selfId, entityType, localId],
    },
  ]
}

export interface AdoptVector {
  entityType: SyncEntityType
  localId: string
  syncId: string
  vector: SyncVector
  selfId: string
  /** The device this transfer was with. Its last sync is stamped `now`. */
  peerId?: string
  now?: number
  /** Last-sync times to restore, for a story whose rows went with the deleted original. */
  lastSynced?: Record<string, number>
}

/**
 * Makes `vector` this item's whole sync state, and goes last in a batch so it overrides whatever
 * the batch's writes counted. The self row is always written for the same reason.
 */
export function adoptVectorStatements(adopt: AdoptVector): SqlStatement[] {
  const { entityType, localId, syncId, vector, selfId, peerId, now, lastSynced } = adopt
  const devices = new Set([...Object.keys(vector), ...Object.keys(lastSynced ?? {}), selfId])
  if (peerId) devices.add(peerId)

  return [
    {
      sql: `DELETE FROM sync_vector WHERE sync_id IN (
              SELECT sync_id FROM sync_identity
              WHERE entity_type = ? AND local_id = ? AND sync_id != ?)`,
      params: [entityType, localId, syncId],
    },
    {
      sql: 'DELETE FROM sync_identity WHERE entity_type = ? AND local_id = ? AND sync_id != ?',
      params: [entityType, localId, syncId],
    },
    {
      sql: 'INSERT OR IGNORE INTO sync_identity (entity_type, local_id, sync_id) VALUES (?, ?, ?)',
      params: [entityType, localId, syncId],
    },
    ...[...devices].map((device) => ({
      sql: `INSERT INTO sync_vector (sync_id, device_id, counter, last_synced_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (sync_id, device_id) DO UPDATE SET
              counter = excluded.counter,
              last_synced_at = COALESCE(excluded.last_synced_at, last_synced_at)`,
      params: [
        syncId,
        device,
        vector[device] ?? 0,
        device === peerId ? (now ?? null) : (lastSynced?.[device] ?? null),
      ],
    })),
  ]
}

export function rememberDeviceStatement(deviceId: string, name: string): SqlStatement {
  return {
    sql: `INSERT INTO sync_device (device_id, name, is_self) VALUES (?, ?, 0)
          ON CONFLICT (device_id) DO UPDATE SET name = excluded.name`,
    params: [deviceId, name],
  }
}
