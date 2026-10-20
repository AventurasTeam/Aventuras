import { describe, expect, it } from 'vitest'
import type { WorldStateChangeRecord } from '#lib/types/index.ts'
import {
  deletedChaptersLine,
  deletedSnapshotsLine,
  describeChange,
  gapMessage,
  revertLines,
} from '.'

const base: WorldStateChangeRecord = {
  id: 'r',
  storyId: 's',
  branchId: null,
  entryId: 'e',
  seq: 1,
  createdAt: 1,
  kind: 'change',
  origin: 'manual',
  entityType: 'character',
  entityId: 'c',
  op: 'update',
  before: { relationship: 'ally' },
  after: { relationship: 'rival' },
}

describe('describeChange', () => {
  it('names the edited fields and looks the name up when the change does not carry it', () => {
    expect(describeChange(base, () => 'Aria')).toBe('Character “Aria” was edited (relationship)')
  })

  it('takes the name from the change itself', () => {
    expect(
      describeChange({
        ...base,
        entityType: 'lorebook_entry',
        op: 'softDelete',
        before: { name: 'Citadel' },
        after: null,
      }),
    ).toBe('Lorebook entry “Citadel” was deleted')
  })

  it('falls back to the kind of thing when no name is known', () => {
    expect(describeChange({ ...base, entityType: 'story_beat', op: 'create', after: {} })).toBe(
      'A quest was added',
    )
  })
})

describe('gapMessage', () => {
  const number = (id: string) => ({ e3: 3, e5: 5 })[id] ?? null

  it('names the entries a pause in tracking lies between', () => {
    expect(gapMessage({ cause: 'header', entryId: 'e5', sinceEntryId: 'e3' }, number)).toBe(
      'State Tracking was off between entry 3 and entry 5.',
    )
  })

  it('names the last recorded entry before a re-enable', () => {
    expect(
      gapMessage({ cause: 'enabledAfter', sinceEntryId: 'e3', enabledSince: 500 }, number),
    ).toBe('State Tracking was off after entry 3.')
  })

  it('places an interruption at the entry it follows', () => {
    expect(gapMessage({ cause: 'break', entryId: 'e3' }, number)).toBe(
      'Recording was interrupted after entry 3.',
    )
  })

  it('names the whole stretch when every entry in it has an old record', () => {
    expect(
      gapMessage({ cause: 'classifierOnly', entryId: 'e3', throughEntryId: 'e5' }, number),
    ).toBe('Entries 3 to 5 have old world state records without the lorebook.')
  })

  it('says when the entry is on another branch', () => {
    expect(gapMessage({ cause: 'untracked', entryId: 'x', throughEntryId: null }, number)).toBe(
      'World state changes were not recorded for an entry on another branch.',
    )
  })
})

describe('revertLines', () => {
  it('says the classifier changes are reverted whenever there are any', () => {
    expect(revertLines(true, [])).toEqual(['Classifier changes will be reverted.'])
    expect(revertLines(false, [])).toEqual([])
  })

  it('stacks the classifier line and the lore lines', () => {
    expect(revertLines(true, [{ number: 4, first: 31, last: 45 }])).toEqual([
      'Classifier changes will be reverted.',
      'Lore management changes of chapter 4 (entries 31–45) will be reverted.',
    ])
  })

  it('spans consecutive chapters', () => {
    expect(
      revertLines(false, [
        { number: 5, first: 46, last: 60 },
        { number: 4, first: 31, last: 45 },
      ]),
    ).toEqual(['Lore management changes of chapters 4–5 (entries 31–60) will be reverted.'])
  })

  it('lists chapters with a gap between them', () => {
    expect(
      revertLines(false, [
        { number: 2, first: 10, last: 20 },
        { number: 4, first: 31, last: 45 },
      ]),
    ).toEqual(['Lore management changes of chapters 2 and 4 (entries 10–45) will be reverted.'])
  })

  it('places the lore of a deleted chapter by its entry', () => {
    expect(revertLines(false, [{ number: null, first: 13, last: 13 }])).toEqual([
      'Lore management changes recorded at entry 13, whose chapter was deleted, will be reverted.',
    ])
    expect(
      revertLines(false, [
        { number: 4, first: 31, last: 45 },
        { number: null, first: 50, last: 50 },
      ]),
    ).toEqual([
      'Lore management changes of chapter 4 (entries 31–45) will be reverted.',
      'Lore management changes recorded at entry 50, whose chapter was deleted, will be reverted.',
    ])
  })
})

describe('deletedChaptersLine', () => {
  it('says which chapters are deleted, or nothing', () => {
    expect(deletedChaptersLine([])).toBeNull()
    expect(deletedChaptersLine([{ number: 4, first: 31, last: 45 }])).toBe(
      'Chapter 4 (entries 31–45) will be deleted.',
    )
    expect(
      deletedChaptersLine([
        { number: 5, first: 46, last: 60 },
        { number: 4, first: 31, last: 45 },
      ]),
    ).toBe('Chapters 4–5 (entries 31–60) will be deleted.')
  })
})

describe('deletedSnapshotsLine', () => {
  it('names the entries of a few snapshots and spans many', () => {
    expect(deletedSnapshotsLine([])).toBeNull()
    expect(deletedSnapshotsLine([40])).toBe('The world-state snapshot at entry 40 will be deleted.')
    expect(deletedSnapshotsLine([55, 40, 40])).toBe(
      '2 world-state snapshots at entries 40 and 55 will be deleted.',
    )
    expect(deletedSnapshotsLine([10, 20, 30, 40, 50])).toBe(
      '5 world-state snapshots between entries 10 and 50 will be deleted.',
    )
  })
})
