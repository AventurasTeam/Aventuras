import type { SyncConnectionData } from '#lib/types/sync.ts'

const PREFIX = 'av1-'

function isConnectionData(value: unknown): value is SyncConnectionData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ip' in value &&
    typeof value.ip === 'string' &&
    value.ip !== '' &&
    'port' in value &&
    typeof value.port === 'number' &&
    isValidPort(value.port) &&
    'token' in value &&
    typeof value.token === 'string' &&
    value.token !== ''
  )
}

/** What a QR code or connection code holds, or null if it is not one. */
export function parseConnectionData(json: string): SyncConnectionData | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!isConnectionData(parsed)) return null
  return {
    ip: parsed.ip,
    port: parsed.port,
    token: parsed.token,
    version: parsed.version,
    protocol: parsed.protocol,
  }
}

/** The QR code's contents as one line of text, for pairing without a camera. */
export function encodeConnectionCode(connection: SyncConnectionData): string {
  const base64 = btoa(JSON.stringify(connection))
  return PREFIX + base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeConnectionCode(code: string): SyncConnectionData | null {
  const trimmed = code.trim()
  if (!trimmed.startsWith(PREFIX)) return null
  const base64 = trimmed.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/')
  try {
    return parseConnectionData(atob(base64))
  } catch {
    return null
  }
}

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535
}
