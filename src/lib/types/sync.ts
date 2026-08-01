/**
 * Types for the local network sync feature
 */

/**
 * Information about the sync server, returned when starting a server
 */
export interface SyncServerInfo {
  ip: string
  port: number
  token: string
  qrCodeBase64: string
}

/**
 * Preview of a story available for sync
 */
export interface SyncStoryPreview {
  id: string
  title: string
  genre: string | null
  updatedAt: number
  entryCount: number
}

/**
 * Data encoded in the QR code for connection
 */
export interface SyncConnectionData {
  ip: string
  port: number
  token: string
  version?: string // App version for compatibility check (optional for backwards compat)
}

/**
 * Current mode of the sync modal
 */
export type SyncMode = 'select' | 'generate' | 'scan' | 'connected' | 'syncing'
