import type {
  ChangeOp,
  ChangeOrigin,
  TrackedEntityType,
  WorldStateRecord,
} from '#lib/types/index.ts'

export const RECORD_COLUMNS = [
  'id',
  'story_id',
  'branch_id',
  'entry_id',
  'kind',
  'origin',
  'entity_type',
  'entity_id',
  'op',
  'before',
  'after',
  'continuous',
  'created_at',
] as const

const json = (value: unknown) => (value == null ? null : JSON.stringify(value))
const parse = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : null)

/** Column values in `RECORD_COLUMNS` order; `seq` is assigned by the insert. */
export function recordToRow(record: WorldStateRecord): unknown[] {
  const change = record.kind === 'change' ? record : null
  const header = record.kind === 'header' ? record : null
  return [
    record.id,
    record.storyId,
    record.branchId,
    record.entryId,
    record.kind,
    change?.origin ?? null,
    change?.entityType ?? null,
    change?.entityId ?? null,
    change?.op ?? null,
    json(change?.before),
    json(change?.after),
    header ? (header.continuous ? 1 : 0) : null,
    record.createdAt,
  ]
}

export function rowToRecord(row: Record<string, unknown>): WorldStateRecord {
  const base = {
    id: row.id as string,
    storyId: row.story_id as string,
    branchId: (row.branch_id as string | null) ?? null,
    entryId: row.entry_id as string,
    seq: row.seq as number,
    createdAt: row.created_at as number,
  }
  switch (row.kind) {
    case 'header':
      return {
        ...base,
        kind: 'header',
        continuous: row.continuous === 1,
        coverage: 'full',
      }
    case 'break':
      return { ...base, kind: 'break' }
    default:
      return {
        ...base,
        kind: 'change',
        origin: row.origin as ChangeOrigin,
        entityType: row.entity_type as TrackedEntityType,
        entityId: row.entity_id as string,
        op: row.op as ChangeOp,
        before: parse(row.before),
        after: parse(row.after),
      }
  }
}
