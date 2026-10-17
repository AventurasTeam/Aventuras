import { describe, expect, it } from 'vitest'
import type { WorldStateRecord } from '#lib/types/index.ts'
import { recordEntityIds, remapRecord, type RecordMappers } from './worldStateRecords'

const ids = new Map([
  ['e-old', 'e-new'],
  ['c-old', 'c-new'],
  ['parent-old', 'parent-new'],
  ['loc-old', 'loc-new'],
])
const mappers: RecordMappers = {
  newStoryId: 'story-new',
  mapEntryId: (id) => ids.get(id),
  mapBranchId: (id) => (id ? `${id}-new` : null),
  mapEntityId: (id) => ids.get(id) ?? `unmapped:${id}`,
  remapMetadata: (metadata) => ({ ...(metadata as object), remapped: true }),
}

const change: WorldStateRecord = {
  id: 'r',
  storyId: 'story-old',
  branchId: 'b',
  entryId: 'e-old',
  seq: 3,
  createdAt: 9,
  kind: 'change',
  origin: 'manual',
  entityType: 'item',
  entityId: 'c-old',
  op: 'softDelete',
  before: {
    id: 'c-old',
    storyId: 'story-old',
    branchId: 'b',
    overridesId: 'parent-old',
    location: 'loc-old',
    metadata: { a: 1 },
  },
  after: null,
}

describe('importing change records', () => {
  it('names every entity a record touches, rows included', () => {
    expect(recordEntityIds(change).sort()).toEqual(['c-old', 'c-old', 'parent-old'].sort())
  })

  it('re-keys the record and the row it carries', () => {
    const out = remapRecord(change, mappers)
    expect(out).toMatchObject({
      storyId: 'story-new',
      branchId: 'b-new',
      entryId: 'e-new',
      entityId: 'c-new',
      before: {
        id: 'c-new',
        storyId: 'story-new',
        branchId: 'b-new',
        overridesId: 'parent-new',
        location: 'loc-new',
        metadata: { a: 1, remapped: true },
      },
    })
    expect(out?.id).not.toBe('r')
  })

  it('drops a record whose entry did not come along', () => {
    expect(remapRecord({ ...change, entryId: 'gone' }, mappers)).toBeNull()
  })

  it('keeps the inventory sentinel', () => {
    const out = remapRecord({ ...change, before: { id: 'c-old', location: 'inventory' } }, mappers)
    expect(out?.kind === 'change' && out.before?.location).toBe('inventory')
  })
})
