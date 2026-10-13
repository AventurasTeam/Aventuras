import type {
  ChangeOp,
  ChangeOrigin,
  TrackedEntityType,
  WorldStateChangeRecord,
} from '#lib/types/index.ts'
import { TRACKED_ENTITY_TYPES, canonicalId, rowsOf, type TrackedState } from './state'

export interface RecordContext {
  storyId: string
  branchId: string | null
  entryId: string
  origin: ChangeOrigin
}

// Derived from other fields, or bookkeeping a revert should not bring back.
const UNRECORDED_FIELDS = new Set([
  'translatedName',
  'translatedDescription',
  'translatedRelationship',
  'translatedTraits',
  'translatedVisualDescriptors',
  'translatedTitle',
  'translationLanguage',
  'updatedAt',
])

const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Previous and new values of the fields `updates` actually changes on `row`. */
export function changedFields(
  row: object,
  updates: object,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const current = row as Record<string, unknown>
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || UNRECORDED_FIELDS.has(key)) continue
    if (sameValue(current[key], value)) continue
    before[key] = current[key] ?? null
    after[key] = value
  }
  return Object.keys(before).length > 0 ? { before, after } : null
}

export function changeRecord(
  ctx: RecordContext,
  entityType: TrackedEntityType,
  entityId: string,
  op: ChangeOp,
  before: object | null,
  after: object | null,
): WorldStateChangeRecord {
  return {
    id: crypto.randomUUID(),
    storyId: ctx.storyId,
    branchId: ctx.branchId,
    entryId: ctx.entryId,
    seq: 0,
    createdAt: Date.now(),
    kind: 'change',
    origin: ctx.origin,
    entityType,
    entityId,
    op,
    before: before ? { ...before } : null,
    after: after ? { ...after } : null,
  }
}

/**
 * The records that turn `before` into `after`. A new row that overrides a row which left the
 * list is recorded as a create shadowing it, as a copy-on-write override is. These are the
 * classifier's, so they carry no `after`.
 */
export function diffStates(
  before: TrackedState,
  after: TrackedState,
  ctx: RecordContext,
): WorldStateChangeRecord[] {
  const records: WorldStateChangeRecord[] = []
  for (const type of TRACKED_ENTITY_TYPES) {
    const old = new Map(rowsOf(before, type).map((r) => [r.id, r]))
    const now = new Map(rowsOf(after, type).map((r) => [r.id, r]))
    const shadowed = new Set<string>()

    for (const row of now.values()) {
      const previous = old.get(row.id)
      if (!previous) {
        const shadow = row.overridesId
          ? [...old.values()].find((r) => !now.has(r.id) && canonicalId(r) === row.overridesId)
          : undefined
        if (shadow) shadowed.add(shadow.id)
        records.push(changeRecord(ctx, type, row.id, 'create', shadow ?? null, row))
        continue
      }
      if (previous === row) continue
      const changed = changedFields(previous, row)
      if (changed)
        records.push(changeRecord(ctx, type, row.id, 'update', changed.before, changed.after))
    }

    for (const row of old.values()) {
      if (now.has(row.id) || shadowed.has(row.id)) continue
      records.push(changeRecord(ctx, type, row.id, 'delete', row, null))
    }
  }
  return records.map((r) => ({ ...r, after: null }))
}
