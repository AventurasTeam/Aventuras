import { describe, expect, it } from 'vitest'
import type { WorldStateChangeRecord, WorldStateMark } from '#lib/types/index.ts'
import { chapterMark, loreOwners, snapshotsHolding } from '.'

const lore = (entryId: string, seq: number) =>
  ({ id: `r${seq}`, entryId, seq, kind: 'change', origin: 'chapter' }) as WorldStateChangeRecord
const mark = (entityId: string, seq: number) =>
  ({ entityType: 'chapter', entityId, seq }) as WorldStateMark

describe('chapterMark', () => {
  it("is the chapter's mark, or -Infinity for one without", () => {
    expect(chapterMark([mark('ch', 4)], 'ch')).toBe(4)
    expect(chapterMark([mark('other', 4)], 'ch')).toBe(-Infinity)
  })
})

describe('loreOwners', () => {
  const chapters = [{ id: 'ch', endEntryId: 'e5' }]

  it('gives the chapter ending on the entry the lore written after its mark', () => {
    expect(loreOwners([lore('e5', 6)], [mark('ch', 5)], chapters)).toEqual([
      { entryId: 'e5', chapterId: 'ch' },
    ])
  })

  it('leaves a deleted chapter the lore written on the same entry before the mark', () => {
    expect(loreOwners([lore('e5', 2), lore('e5', 6)], [mark('ch', 5)], chapters)).toEqual([
      { entryId: 'e5', chapterId: 'ch' },
      { entryId: 'e5', chapterId: null },
    ])
    expect(loreOwners([lore('e5', 2)], [mark('ch', 5)], chapters)).toEqual([
      { entryId: 'e5', chapterId: null },
    ])
  })

  it('leaves a deleted chapter the lore on an entry no chapter ends at', () => {
    expect(loreOwners([lore('e3', 2)], [], chapters)).toEqual([{ entryId: 'e3', chapterId: null }])
  })
})

describe('snapshotsHolding', () => {
  const snap = (entityId: string, seq: number, entryId: string) =>
    ({ entityType: 'snapshot', entityId, seq, entryId }) as WorldStateMark

  it('takes the snapshots on the line marked after the first reverted record', () => {
    const marks = [
      snap('before', 1, 'e1'),
      snap('after', 5, 'e4'),
      // An ancestor branch's snapshot past the fork: not on this line.
      snap('parent', 6, 'p9'),
      { ...snap('chapter', 7, 'e4'), entityType: 'chapter' } as WorldStateMark,
    ]
    const held = snapshotsHolding(
      marks,
      [lore('e3', 3), lore('e3', 4)],
      new Set(['e1', 'e3', 'e4']),
    )
    expect(held.map((m) => m.entityId)).toEqual(['after'])
  })
})
