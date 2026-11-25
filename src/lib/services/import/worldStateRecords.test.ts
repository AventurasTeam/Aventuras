import { describe, expect, it } from 'vitest'
import type { WorldStateMark, WorldStateRecord } from '#lib/types/index.ts'
import {
  inWriteOrder,
  recordEntityIds,
  remapMark,
  remapRecord,
  type RecordMappers,
} from './worldStateRecords'

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

describe('importing marks', () => {
  const mark = (entityId: string, seq: number, createdAt: number): WorldStateMark => ({
    id: `m-${entityId}`,
    storyId: 'story-old',
    branchId: null,
    entryId: 'e-old',
    seq,
    entityType: 'checkpoint',
    entityId,
    createdAt,
  })
  const record = (id: string, seq: number, createdAt: number) =>
    ({ id, seq, createdAt, kind: 'header' }) as WorldStateRecord
  const order = (written: ReturnType<typeof inWriteOrder>) =>
    written.map((w) => ('record' in w ? w.record.id : w.mark.entityId))

  it('re-keys a mark, and drops one whose entry or owner did not come along', () => {
    const m = {
      newStoryId: 'story-new',
      mapEntryId: (id: string) => ids.get(id),
      mapBranchId: (id: string | null) => id,
      mapMarkedId: (_type: string, id: string) => (id === 'cp-old' ? 'cp-new' : undefined),
    }
    expect(remapMark(mark('cp-old', 1, 1), m)).toMatchObject({
      storyId: 'story-new',
      entryId: 'e-new',
      entityId: 'cp-new',
    })
    expect(remapMark(mark('gone', 1, 1), m)).toBeNull()
    expect(remapMark({ ...mark('cp-old', 1, 1), entryId: 'missing' }, m)).toBeNull()
  })

  it("keeps the file's marks where they fall among its records", () => {
    const written = inWriteOrder({
      converted: [],
      records: [record('a', 1, 10), record('b', 3, 30)],
      marks: [mark('cp', 2, 99)],
      unmarked: [],
      positionOf: () => 0,
    })
    expect(order(written)).toEqual(['a', 'cp', 'b'])
  })

  it('places an owner without a mark after what was written by the time it was made', () => {
    const written = inWriteOrder({
      converted: [],
      records: [record('a', 1, 10), record('b', 2, 30)],
      marks: [],
      unmarked: [mark('late', 0, 50), mark('mid', 0, 20), mark('first', 0, 5)],
      positionOf: () => 0,
    })
    expect(order(written)).toEqual(['first', 'a', 'mid', 'b', 'late'])
  })

  it('places one among converted records by its entry, whatever their times', () => {
    // A sync re-created the entries, and so their converted records, after the checkpoint.
    const on = (id: string, entryId: string) => ({ ...record(id, 0, 1000), entryId })
    const written = inWriteOrder({
      converted: [on('h1', 'e1'), on('h2', 'e2'), on('h3', 'e3')],
      records: [],
      marks: [],
      unmarked: [{ ...mark('cp', 0, 10), entryId: 'e2' }],
      positionOf: (id) => Number(id.slice(1)),
    })
    expect(order(written)).toEqual(['h1', 'h2', 'cp', 'h3'])
  })
})
