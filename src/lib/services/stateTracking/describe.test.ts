import { describe, expect, it } from 'vitest'
import type { WorldStateChangeRecord } from '#lib/types/index.ts'
import { describeChange } from '.'

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
