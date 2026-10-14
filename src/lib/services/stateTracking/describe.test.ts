import { describe, expect, it } from 'vitest'
import type { WorldStateChangeRecord } from '#lib/types/index.ts'
import { describeChange, gapMessage, loreLine } from '.'

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

describe('loreLine', () => {
  it('says only the classifier is undone when no chapter lore is', () => {
    expect(loreLine([])).toBe("Only the classifier's changes are undone.")
  })

  it("says nothing then when the reader's or Tidy's changes are listed", () => {
    expect(loreLine([], true)).toBeNull()
    expect(loreLine([{ number: 4, first: 31, last: 45 }], true)).toBe(
      'This also undoes the lore management of chapter 4 (entries 31–45).',
    )
  })

  it('names one chapter with its entries', () => {
    expect(loreLine([{ number: 4, first: 31, last: 45 }])).toBe(
      'This also undoes the lore management of chapter 4 (entries 31–45).',
    )
  })

  it('spans consecutive chapters', () => {
    expect(
      loreLine([
        { number: 5, first: 46, last: 60 },
        { number: 4, first: 31, last: 45 },
      ]),
    ).toBe('This also undoes the lore management of chapters 4–5 (entries 31–60).')
  })

  it('lists chapters with a gap between them', () => {
    expect(
      loreLine([
        { number: 2, first: 10, last: 20 },
        { number: 4, first: 31, last: 45 },
      ]),
    ).toBe('This also undoes the lore management of chapters 2 and 4 (entries 10–45).')
  })

  it('places the lore of a deleted chapter by its entry', () => {
    expect(loreLine([{ number: null, first: 13, last: 13 }])).toBe(
      'This also undoes lore management recorded at entry 13, whose chapter was deleted.',
    )
    expect(
      loreLine([
        { number: 4, first: 31, last: 45 },
        { number: null, first: 50, last: 50 },
      ]),
    ).toBe(
      'This also undoes the lore management of chapter 4 (entries 31–45). ' +
        'It also undoes lore management recorded at entry 50, whose chapter was deleted.',
    )
  })
})
