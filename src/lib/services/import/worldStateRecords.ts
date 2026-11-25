import type {
  TrackedEntityType,
  WorldStateMark,
  WorldStateMarkType,
  WorldStateRecord,
} from '#lib/types/index.ts'
import { markId } from '#lib/services/stateTracking/index.ts'

/** Every entity id a record names, including the ids inside the rows it carries. */
export function recordEntityIds(record: WorldStateRecord): string[] {
  if (record.kind !== 'change') return []
  const ids = [record.entityId]
  for (const row of [record.before, record.after]) {
    if (typeof row?.id === 'string') ids.push(row.id)
    if (typeof row?.overridesId === 'string') ids.push(row.overridesId)
    if (typeof row?.mergedInto === 'string') ids.push(row.mergedInto)
  }
  return ids
}

export interface RecordMappers {
  newStoryId: string
  mapEntryId: (id: string) => string | undefined
  mapBranchId: (id: string | null) => string | null
  /** Ids are pre-mapped, so this always answers for an id a record names. */
  mapEntityId: (id: string) => string
  remapMetadata: (metadata: unknown, type: TrackedEntityType) => unknown
}

function remapRow(
  row: Record<string, unknown> | null,
  type: TrackedEntityType,
  m: RecordMappers,
): Record<string, unknown> | null {
  if (!row) return null
  const out: Record<string, unknown> = { ...row }
  if (typeof out.id === 'string') out.id = m.mapEntityId(out.id)
  if ('storyId' in out) out.storyId = m.newStoryId
  if ('branchId' in out) out.branchId = m.mapBranchId((out.branchId as string | null) ?? null)
  if (typeof out.overridesId === 'string') out.overridesId = m.mapEntityId(out.overridesId)
  if (typeof out.mergedInto === 'string') out.mergedInto = m.mapEntityId(out.mergedInto)
  if ('metadata' in out && out.metadata) out.metadata = m.remapMetadata(out.metadata, type)
  // An item's location is a location id, or the 'inventory' sentinel.
  if (type === 'item' && typeof out.location === 'string' && out.location !== 'inventory') {
    out.location = m.mapEntityId(out.location)
  }
  if (type === 'location' && Array.isArray(out.connections)) {
    out.connections = out.connections.map((id) => (typeof id === 'string' ? m.mapEntityId(id) : id))
  }
  return out
}

/** A record re-keyed for the imported story, or null when its entry did not come along. */
export function remapRecord(record: WorldStateRecord, m: RecordMappers): WorldStateRecord | null {
  const entryId = m.mapEntryId(record.entryId)
  if (!entryId) return null
  const base = {
    ...record,
    id: crypto.randomUUID(),
    storyId: m.newStoryId,
    branchId: m.mapBranchId(record.branchId),
    entryId,
  }
  switch (base.kind) {
    case 'header':
    case 'break':
      return base
    case 'change':
      return {
        ...base,
        entityId: m.mapEntityId(base.entityId),
        before: remapRow(base.before, base.entityType, m),
        after: remapRow(base.after, base.entityType, m),
      }
  }
}

export interface MarkMappers {
  newStoryId: string
  mapEntryId: (id: string) => string | undefined
  mapBranchId: (id: string | null) => string | null
  /** The imported chapter's or checkpoint's id; undefined for anything else. */
  mapMarkedId: (type: WorldStateMarkType, id: string) => string | undefined
}

/** A mark re-keyed for the imported story, or null when its entry or owner did not come along. */
export function remapMark(mark: WorldStateMark, m: MarkMappers): WorldStateMark | null {
  const entryId = m.mapEntryId(mark.entryId)
  const entityId = m.mapMarkedId(mark.entityType, mark.entityId)
  if (!entryId || !entityId) return null
  return {
    ...mark,
    id: markId(mark.entityType, entityId),
    storyId: m.newStoryId,
    branchId: m.mapBranchId(mark.branchId),
    entryId,
    entityId,
  }
}

export type Written = { record: WorldStateRecord } | { mark: WorldStateMark }

export interface WriteOrderInput {
  /** Records converted from an older file's deltas, in story order. */
  converted: WorldStateRecord[]
  /** The file's own records, which carry their write order in `seq`. */
  records: WorldStateRecord[]
  /** The file's marks. */
  marks: WorldStateMark[]
  /** Marks for the chapters and checkpoints the file has none for. */
  unmarked: WorldStateMark[]
  /** Position of an imported entry, by its new id. */
  positionOf: (entryId: string) => number | undefined
}

/**
 * Records and marks in one write order: converted records first, then the file's records with
 * its marks among them by `seq`. A mark for an `unmarked` owner goes after the last of the file's
 * records written by the time the owner was made; without one, after the converted records of
 * entries up to its own. A converted record's time is its entry's, which a sync or import resets,
 * while an old snapshot or checkpoint was taken with its entry the latest classified.
 */
export function inWriteOrder(input: WriteOrderInput): Written[] {
  type Item = { written: Written; at: number; converted: boolean; position: number }
  const position = (entryId: string) => input.positionOf(entryId) ?? -Infinity
  const items: Item[] = input.converted.map((record) => ({
    written: { record },
    at: record.createdAt,
    converted: true,
    position: position(record.entryId),
  }))
  const timed = (written: Written, at: number): Item => ({
    written,
    at,
    converted: false,
    position: 0,
  })
  const marks = [...input.marks].sort((a, b) => a.seq - b.seq)
  let next = 0
  for (const record of input.records) {
    for (; next < marks.length && marks[next].seq < record.seq; next++) {
      items.push(timed({ mark: marks[next] }, marks[next].createdAt))
    }
    items.push(timed({ record }, record.createdAt))
  }
  for (const mark of marks.slice(next)) items.push(timed({ mark }, mark.createdAt))

  // Each owner goes after the last of the file's own items written by its time, or else after
  // the last converted record at or before its entry. Found by binary search over suffix minima,
  // which never decrease, then inserted in one pass; owners sharing a place keep their time order.
  const lastAtOrBefore = (picked: number[], key: (index: number) => number) => {
    const suffixMin = new Array<number>(picked.length)
    for (let k = picked.length - 1, min = Infinity; k >= 0; k--) {
      min = Math.min(min, key(picked[k]))
      suffixMin[k] = min
    }
    return (limit: number) => {
      let lo = 0
      let hi = picked.length - 1
      let found = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (suffixMin[mid] <= limit) {
          found = mid
          lo = mid + 1
        } else hi = mid - 1
      }
      return found < 0 ? -1 : picked[found]
    }
  }
  const indices = items.map((_, i) => i)
  const byTime = lastAtOrBefore(
    indices.filter((i) => !items[i].converted),
    (i) => items[i].at,
  )
  const byEntry = lastAtOrBefore(
    indices.filter((i) => items[i].converted),
    (i) => items[i].position,
  )
  const after: Written[][] = items.map(() => [])
  const first: Written[] = []
  for (const mark of [...input.unmarked].sort((a, b) => a.createdAt - b.createdAt)) {
    const timed = byTime(mark.createdAt)
    const at = timed >= 0 ? timed : byEntry(position(mark.entryId))
    ;(at >= 0 ? after[at] : first).push({ mark })
  }
  return [...first, ...items.flatMap((item, i) => [item.written, ...after[i]])]
}
