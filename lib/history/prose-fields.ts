import { isJsonObject } from '@/lib/json-object'

import { HISTORY_TABLES, type HistoryTable } from './field-labels'
import { changedPaths } from './humanize'
import { HISTORY_LINK_TABLES, type HistoryLinkTable } from './link-rows'

export type DiffTable = HistoryTable | HistoryLinkTable

/** The tables World and Plot History list: the four row tables, then the three link tables. */
export const DIFF_TABLES: readonly DiffTable[] = [...HISTORY_TABLES, ...HISTORY_LINK_TABLES]

/** A field's wording in world.md → Change prose. */
export type ProseFieldKind =
  | 'text'
  | 'enum'
  | 'number'
  | 'flag'
  | 'rowRef'
  | 'entryRef'
  | 'termList'
  | 'refList'
  | 'record'
  | 'lastSeen'
  | 'placement'
  | 'collision'

/** A diff entry's two sides, as the cache stores them. */
export type DiffValues = {
  readonly old: Readonly<Record<string, unknown>>
  readonly new: Readonly<Record<string, unknown>>
}

type Kinds = Readonly<Record<string, ProseFieldKind>>

// world.md → Change prose, by payload path. A path missing here has no wording, so its row keeps
// the field-name summary.
const ENTITY: Kinds = {
  name: 'text',
  description: 'text',
  retiredReason: 'text',
  'state.voice': 'text',
  'state.condition': 'text',
  'state.standing': 'text',
  'state.visual.physique': 'text',
  'state.visual.face': 'text',
  'state.visual.hair': 'text',
  'state.visual.eyes': 'text',
  'state.visual.attire': 'text',
  'state.visual.distinguishing': 'text',
  status: 'enum',
  injectionMode: 'enum',
  priority: 'number',
  tags: 'termList',
  keywords: 'termList',
  'state.traits': 'termList',
  'state.drives': 'termList',
  'state.agenda': 'termList',
  'state.current_location_id': 'rowRef',
  'state.faction_id': 'rowRef',
  'state.at_location_id': 'rowRef',
  'state.inventory': 'refList',
  'state.equipped_items': 'refList',
  'state.stackables': 'record',
  'state.lastSeenAt': 'lastSeen',
  'state.parent_location_id': 'placement',
  'state.unplaced': 'placement',
  nameCollisionFlag: 'collision',
  nameCollisionPartnerId: 'collision',
  nameCollisionReason: 'collision',
}

const LORE: Kinds = {
  title: 'text',
  body: 'text',
  category: 'text',
  tags: 'termList',
  keywords: 'termList',
  injectionMode: 'enum',
  priority: 'number',
}

const THREAD: Kinds = {
  title: 'text',
  description: 'text',
  category: 'text',
  icon: 'text',
  status: 'enum',
  injectionMode: 'enum',
  triggeredAtEntryId: 'entryRef',
  resolvedAtEntryId: 'entryRef',
}

const HAPPENING: Kinds = {
  title: 'text',
  description: 'text',
  category: 'text',
  icon: 'text',
  temporal: 'text',
  occurredAtEntryId: 'entryRef',
  commonKnowledge: 'flag',
}

const KINDS: Readonly<Record<DiffTable, Kinds>> = {
  entities: ENTITY,
  lore: LORE,
  threads: THREAD,
  happenings: HAPPENING,
  character_relationships: { kind: 'text', inverseKind: 'text' },
  happening_involvements: { role: 'text' },
  happening_awareness: {
    source: 'text',
    decayResistance: 'number',
    retrievalCount: 'number',
    learnedAtEntryId: 'entryRef',
  },
}

/** The entity columns Change prose words as one collision field. */
export const COLLISION_COLUMNS = [
  'nameCollisionFlag',
  'nameCollisionPartnerId',
  'nameCollisionReason',
] as const

const PLACE_PARENT = 'state.parent_location_id'
const COLLISION_PARTNER = 'nameCollisionPartnerId'

/** A payload path's kind per world.md → Change prose; undefined when it has no wording. */
export function proseFieldOf(table: DiffTable, path: string): ProseFieldKind | undefined {
  const kinds = KINDS[table]
  return Object.hasOwn(kinds, path) ? kinds[path] : undefined
}

/** The entry's paths in payload order, read off `old` as `changedPaths` reads a payload. */
export function diffPaths(entry: DiffValues): string[] {
  return changedPaths({ op: 'update', undoPayload: entry.old })
}

// undefined where the path is absent: a stored JSON value is never undefined.
export function valueAt(side: Readonly<Record<string, unknown>>, path: string): unknown {
  let value: unknown = side
  for (const key of path.split('.')) {
    if (!isJsonObject(value) || !Object.hasOwn(value, key)) return undefined
    value = value[key]
  }
  return value
}

// A null side names no place.
function lastSeenPlace(side: unknown): unknown {
  return isJsonObject(side) ? side.locationId : undefined
}

/** Every entity id the entry's ref paths hold on either side, deduplicated, first seen first. */
export function refIdsOf(table: DiffTable, entry: DiffValues): string[] {
  const ids = new Set<string>()
  const add = (value: unknown) => {
    if (typeof value === 'string') ids.add(value)
  }
  for (const path of diffPaths(entry)) {
    switch (proseFieldOf(table, path)) {
      case 'rowRef':
        add(valueAt(entry.old, path))
        add(valueAt(entry.new, path))
        break
      case 'refList':
        for (const side of [entry.old, entry.new]) {
          const list = valueAt(side, path)
          if (Array.isArray(list)) list.forEach(add)
        }
        break
      case 'placement':
        add(valueAt(entry.old, PLACE_PARENT))
        add(valueAt(entry.new, PLACE_PARENT))
        break
      case 'collision':
        add(valueAt(entry.old, COLLISION_PARTNER))
        add(valueAt(entry.new, COLLISION_PARTNER))
        break
      case 'lastSeen':
        add(lastSeenPlace(valueAt(entry.old, path)))
        add(lastSeenPlace(valueAt(entry.new, path)))
        break
    }
  }
  return [...ids]
}

/** Every entry id the entry's prose names, either side: its entry refs and lastSeenAt's entry. */
export function entryIdsOf(table: DiffTable, entry: DiffValues): string[] {
  const ids = new Set<string>()
  const add = (value: unknown) => {
    if (typeof value === 'string' && value !== '') ids.add(value)
  }
  for (const path of diffPaths(entry)) {
    const kind = proseFieldOf(table, path)
    for (const side of [entry.old, entry.new]) {
      const value = valueAt(side, path)
      if (kind === 'entryRef') add(value)
      else if (kind === 'lastSeen' && isJsonObject(value)) add(value.entryId)
    }
  }
  return [...ids]
}
