import type {
  SyncListItem,
  SyncListPrefs,
  SyncLocalItem,
  SyncRow,
  SyncRowAction,
  SyncSection,
  SyncSort,
  SyncStatus,
} from '#lib/types/sync.ts'
import { compareVectors } from './vectors'

/** Most in need of attention first. */
export const STATUS_ORDER: readonly SyncStatus[] = [
  'changedOnBoth',
  'sameName',
  'newerThere',
  'newerHere',
  'onlyThere',
  'onlyHere',
  'inSync',
]

export const NEEDS_ACTION: readonly SyncStatus[] = STATUS_ORDER.filter((s) => s !== 'inSync')

export const DEFAULT_LIST_PREFS: SyncListPrefs = {
  statuses: [...STATUS_ORDER],
  sort: 'status',
  reversed: false,
}

const ACTIONS: Record<SyncStatus, SyncRowAction> = {
  changedOnBoth: 'resolve',
  sameName: 'choose',
  newerThere: 'get',
  newerHere: 'send',
  onlyThere: 'get',
  onlyHere: 'send',
  inSync: null,
}

function row(
  status: SyncStatus,
  local: SyncLocalItem | null,
  remote: SyncListItem | null,
  peerId: string,
): SyncRow {
  return {
    key: local ? `here:${local.localId}` : `there:${remote?.localId}`,
    name: local?.name ?? remote?.name ?? '',
    status,
    action: ACTIONS[status],
    local,
    remote,
    lastSyncedAt: local?.lastSynced[peerId] ?? null,
  }
}

function pairingKey(section: SyncSection, item: SyncListItem): string {
  return section === 'packs' ? JSON.stringify([item.name, item.author ?? null]) : item.name
}

/** Items no other item on the same device could also be paired with. */
function uniqueByKey<T extends SyncListItem>(section: SyncSection, items: T[]): Map<string, T> {
  const unique = new Map<string, T>()
  const taken = new Set<string>()
  for (const item of items) {
    const key = pairingKey(section, item)
    if (taken.has(key)) unique.delete(key)
    else unique.set(key, item)
    taken.add(key)
  }
  return unique
}

/**
 * One row per item: copies are joined on sync identity, then by name where at least one side has
 * no identity yet and the name leaves no doubt which item it is.
 */
export function buildRows(
  section: SyncSection,
  localItems: SyncLocalItem[],
  remoteItems: SyncListItem[],
  peerId: string,
): SyncRow[] {
  const rows: SyncRow[] = []
  const remoteBySyncId = new Map(
    remoteItems.flatMap((r) => (r.syncId ? [[r.syncId, r] as const] : [])),
  )
  const joined = new Set<SyncListItem>()
  const unmatchedLocal: SyncLocalItem[] = []

  for (const local of localItems) {
    const remote = local.syncId ? remoteBySyncId.get(local.syncId) : undefined
    if (remote) {
      joined.add(remote)
      rows.push(row(compareVectors(local.vector ?? {}, remote.vector ?? {}), local, remote, peerId))
    } else {
      unmatchedLocal.push(local)
    }
  }

  const unmatchedRemote = remoteItems.filter((r) => !joined.has(r))
  const localByKey = uniqueByKey(section, unmatchedLocal)
  const remoteByKey = uniqueByKey(section, unmatchedRemote)
  const paired = new Set<SyncListItem>()

  for (const [key, local] of localByKey) {
    const remote = remoteByKey.get(key)
    if (remote && (!local.syncId || !remote.syncId)) {
      paired.add(local).add(remote)
      rows.push(row('sameName', local, remote, peerId))
    }
  }

  for (const local of unmatchedLocal) {
    if (!paired.has(local)) rows.push(row('onlyHere', local, null, peerId))
  }
  for (const remote of unmatchedRemote) {
    if (!paired.has(remote)) rows.push(row('onlyThere', null, remote, peerId))
  }
  return rows
}

export function countByStatus(rows: SyncRow[]): Record<SyncStatus, number> {
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<SyncStatus, number>
  for (const r of rows) counts[r.status]++
  return counts
}

function lastChanged(r: SyncRow): number {
  return Math.max(r.local?.updatedAt ?? 0, r.remote?.updatedAt ?? 0)
}

function byName(a: SyncRow, b: SyncRow): number {
  return a.name.localeCompare(b.name)
}

const COMPARATORS: Record<SyncSort, (a: SyncRow, b: SyncRow) => number> = {
  status: (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
  name: byName,
  lastSynced: (a, b) => (b.lastSyncedAt ?? 0) - (a.lastSyncedAt ?? 0),
  lastChanged: (a, b) => lastChanged(b) - lastChanged(a),
}

/** Never-synced items stay last under "last synced", whichever way the rest run. */
export function sortRows(rows: SyncRow[], sort: SyncSort, reversed: boolean): SyncRow[] {
  const direction = reversed ? -1 : 1
  const compare = COMPARATORS[sort]
  return rows.toSorted((a, b) => {
    if (sort === 'lastSynced' && (a.lastSyncedAt === null) !== (b.lastSyncedAt === null)) {
      return a.lastSyncedAt === null ? 1 : -1
    }
    return direction * compare(a, b) || byName(a, b)
  })
}

export interface SyncListView {
  rows: SyncRow[]
  /** Items matching the search that the status filter hides. */
  hidden: number
}

export function viewRows(rows: SyncRow[], search: string, prefs: SyncListPrefs): SyncListView {
  const query = search.trim().toLowerCase()
  const found = query ? rows.filter((r) => r.name.toLowerCase().includes(query)) : rows
  const shown = found.filter((r) => prefs.statuses.includes(r.status))
  return {
    rows: sortRows(shown, prefs.sort, prefs.reversed),
    hidden: found.length - shown.length,
  }
}

/** "3d ago", for rows and sheets. */
export function formatAgo(time: number, now = Date.now()): string {
  const minutes = Math.floor((now - time) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  if (days < 60) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

/** Stored preferences, tolerating anything an older or damaged value holds. */
export function parseListPrefs(raw: string | null): Partial<Record<SyncSection, SyncListPrefs>> {
  try {
    const parsed = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object') return {}
    const prefs: Partial<Record<SyncSection, SyncListPrefs>> = {}
    for (const [section, value] of Object.entries(parsed)) {
      const v = value as Partial<SyncListPrefs> | null
      if (!v || !Array.isArray(v.statuses) || !v.sort || !(v.sort in COMPARATORS)) continue
      prefs[section as SyncSection] = {
        statuses: v.statuses.filter((s) => STATUS_ORDER.includes(s)),
        sort: v.sort,
        reversed: !!v.reversed,
      }
    }
    return prefs
  } catch {
    return {}
  }
}
