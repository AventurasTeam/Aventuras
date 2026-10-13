import { describe, expect, it } from 'vitest'
import type { WorldStateRecord } from '#lib/types/index.ts'
import { RECORD_COLUMNS, recordToRow, rowToRecord } from '.'

const base = { storyId: 's', branchId: 'b', entryId: 'e', seq: 7, createdAt: 123 }

function roundTrip(record: WorldStateRecord): WorldStateRecord {
  const values = recordToRow(record)
  const row = Object.fromEntries(RECORD_COLUMNS.map((c, i) => [c, values[i]]))
  return rowToRecord({ ...row, seq: record.seq })
}

describe('record rows', () => {
  it('round-trips a change with its before and after values', () => {
    const record: WorldStateRecord = {
      ...base,
      id: 'r1',
      kind: 'change',
      origin: 'manual',
      entityType: 'lorebook_entry',
      entityId: 'x',
      op: 'update',
      before: { description: 'old', aliases: ['a'] },
      after: { description: 'new', aliases: [] },
    }
    expect(roundTrip(record)).toEqual(record)
  })

  it('round-trips a header', () => {
    const record: WorldStateRecord = {
      ...base,
      id: 'h1',
      kind: 'header',
      continuous: true,
      locationBefore: 'loc',
      coverage: 'full',
    }
    expect(roundTrip(record)).toEqual(record)
  })

  it('round-trips a break', () => {
    const record: WorldStateRecord = { ...base, id: 'b1', kind: 'break' }
    expect(roundTrip(record)).toEqual(record)
  })

  it('stores a header that does not continue a run as 0', () => {
    const values = recordToRow({
      ...base,
      id: 'h2',
      kind: 'header',
      continuous: false,
      locationBefore: null,
      coverage: 'full',
    })
    expect(values[RECORD_COLUMNS.indexOf('continuous')]).toBe(0)
  })
})
