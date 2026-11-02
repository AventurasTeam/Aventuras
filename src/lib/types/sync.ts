/**
 * Types for the local network sync feature
 */

/** Must match `PROTOCOL_VERSION` in `src-tauri/src/sync/types.rs`. */
export const SYNC_PROTOCOL_VERSION = 2

export const SYNC_SECTIONS = ['stories', 'characters', 'lorebooks', 'scenarios', 'packs'] as const

export type SyncSection = (typeof SYNC_SECTIONS)[number]

/** How a section is stored in `sync_identity.entity_type`. */
export type SyncEntityType = 'story' | 'character' | 'lorebook' | 'scenario' | 'pack'

/** Edits per device. A device missing from it has made none. */
export type SyncVector = Record<string, number>

/**
 * Information about the sync server, returned when starting a server
 */
export interface SyncServerInfo {
  ip: string
  port: number
  token: string
  qrCodeBase64: string
}

/** A device, as sent with every request and listing. */
export interface SyncPeer {
  deviceId: string
  name: string
}

/** One item as a device lists it. Carries no content. */
export interface SyncListItem {
  localId: string
  name: string
  author?: string | null
  updatedAt: number
  syncId: string | null
  vector: SyncVector | null
}

/** An item on this device, with what only this device knows. */
export interface SyncLocalItem extends SyncListItem {
  /** When this item last synced, by device. */
  lastSynced: Record<string, number>
}

export interface SyncListing {
  device: SyncPeer
  items: SyncListItem[]
}

/** An item on the wire. `document` is JSON text in the form the item's section exports. */
export interface SyncEnvelope {
  section: SyncSection
  syncId: string
  vector: SyncVector
  updatedAt: number
  name: string
  author?: string | null
  document: string
}

/** A pushed item waiting on this device. */
export interface SyncReceivedItem {
  requestId: string
  peer: SyncPeer
  payload: string
}

/** How a push ended. `waiting`: the receiver did not answer in time, and may still accept. */
export type SyncPushOutcome = 'applied' | 'declined' | 'waiting'

export type SyncAction =
  | { type: 'list'; section: SyncSection }
  | { type: 'pull'; section: SyncSection; localId: string }
  | { type: 'push'; payload: string }
  | {
      type: 'settleVector'
      section: SyncSection
      syncId: string
      expected: SyncVector
      vector: SyncVector
    }

/** A request forwarded from the Rust server. */
export interface SyncWebviewRequest {
  requestId: string
  peer: SyncPeer
  action: SyncAction
}

/**
 * Data encoded in the QR code for connection
 */
export interface SyncConnectionData {
  ip: string
  port: number
  token: string
  version?: string // App version for compatibility check (optional for backwards compat)
  protocol?: number
}

export type SyncStatus =
  | 'changedOnBoth'
  /** The two copies share a name and have never synced. */
  | 'sameName'
  | 'newerThere'
  | 'newerHere'
  | 'onlyThere'
  | 'onlyHere'
  | 'inSync'

export type SyncRowAction = 'send' | 'get' | 'resolve' | 'choose' | null

/** One item across both devices. */
export interface SyncRow {
  key: string
  name: string
  status: SyncStatus
  action: SyncRowAction
  local: SyncLocalItem | null
  remote: SyncListItem | null
  lastSyncedAt: number | null
}

export type SyncSort = 'status' | 'name' | 'lastSynced' | 'lastChanged'

/** What a section remembers between visits. */
export interface SyncListPrefs {
  statuses: SyncStatus[]
  sort: SyncSort
  reversed: boolean
}

/**
 * Current mode of the sync modal
 */
export type SyncMode = 'select' | 'generate' | 'scan' | 'connected'
