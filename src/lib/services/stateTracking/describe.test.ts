import { describe, expect, it } from 'vitest'
import type { WorldStateChangeRecord } from '#lib/types/index.ts'
import { describeChange, gapMessage } from '.'

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
  const number = (id: string) => (id === 'e5' ? 5 : null)
  const time = (ms: number) => `t${ms}`

  it('points at the entry whose header broke the run', () => {
    expect(gapMessage({ cause: 'header', entryId: 'e5', at: 51, since: 41 }, number, time)).toBe(
      'World state changes were not recorded for a while between t41 and t51, before those of entry 5.',
    )
  })

  it('gives both times when tracking was turned on after the last record', () => {
    const message = gapMessage(
      { cause: 'enabledAfter', lastProofAt: 61, enabledSince: 500 },
      number,
      time,
    )
    expect(message).toContain('t61')
    expect(message).toContain('t500')
  })

  it('says when the entry is not on this branch', () => {
    expect(gapMessage({ cause: 'break', entryId: 'x', at: 1 }, number, time)).toContain(
      'an entry not on this branch',
    )
  })
})
