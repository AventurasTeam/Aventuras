import type { TrackedEntityType, WorldStateRecord } from '#lib/types/index.ts'

/** Every entity id a record names, including the ids inside the rows it carries. */
export function recordEntityIds(record: WorldStateRecord): string[] {
  if (record.kind === 'header') return record.locationBefore ? [record.locationBefore] : []
  if (record.kind !== 'change') return []
  const ids = [record.entityId]
  for (const row of [record.before, record.after]) {
    if (typeof row?.id === 'string') ids.push(row.id)
    if (typeof row?.overridesId === 'string') ids.push(row.overridesId)
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
      return {
        ...base,
        locationBefore: base.locationBefore ? m.mapEntityId(base.locationBefore) : null,
      }
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
