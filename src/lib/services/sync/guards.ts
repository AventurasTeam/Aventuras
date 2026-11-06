import {
  SYNC_SECTIONS,
  type SyncEnvelope,
  type SyncListItem,
  type SyncListing,
  type SyncPeer,
  type SyncSection,
  type SyncVector,
} from '#lib/types/sync.ts'

/** What the other device sent, checked before anything trusts its shape. */
type Unchecked = { [key: string]: unknown }

export function isObject(value: unknown): value is Unchecked {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isSyncSection(value: unknown): value is SyncSection {
  return SYNC_SECTIONS.some((section) => section === value)
}

export function isSyncVector(value: unknown): value is SyncVector {
  return (
    isObject(value) &&
    Object.values(value).every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0)
  )
}

function isSyncPeer(value: unknown): value is SyncPeer {
  return isObject(value) && typeof value.deviceId === 'string' && typeof value.name === 'string'
}

const isOptionalAuthor = (value: unknown) =>
  value === undefined || value === null || typeof value === 'string'

function isSyncListItem(value: unknown): value is SyncListItem {
  return (
    isObject(value) &&
    typeof value.localId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.updatedAt === 'number' &&
    (value.syncId === null || typeof value.syncId === 'string') &&
    (value.vector === null || isSyncVector(value.vector)) &&
    isOptionalAuthor(value.author)
  )
}

export function isSyncListing(value: unknown): value is SyncListing {
  return (
    isObject(value) &&
    isSyncPeer(value.device) &&
    Array.isArray(value.items) &&
    value.items.every(isSyncListItem)
  )
}

export function isEnvelopeHeader(value: unknown): value is Omit<SyncEnvelope, 'document'> {
  return (
    isObject(value) &&
    isSyncSection(value.section) &&
    typeof value.syncId === 'string' &&
    isSyncVector(value.vector) &&
    typeof value.updatedAt === 'number' &&
    typeof value.name === 'string' &&
    isOptionalAuthor(value.author)
  )
}
