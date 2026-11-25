import { describe, expect, it } from 'vitest'
import type { Character } from '#lib/types/index.ts'
import {
  changeRecord,
  changedFields,
  diffStates,
  planReversal,
  type RecordContext,
  type TrackedState,
} from '.'

const ctx: RecordContext = { storyId: 's', branchId: 'b', entryId: 'e1', origin: 'classifier' }

function character(id: string, fields: Partial<Character> = {}): Character {
  return {
    id,
    storyId: 's',
    name: id,
    description: null,
    relationship: null,
    traits: [],
    visualDescriptors: {},
    portrait: null,
    status: 'active',
    metadata: null,
    branchId: null,
    ...fields,
  }
}

function state(characters: Character[]): TrackedState {
  return {
    characters,
    locations: [],
    items: [],
    storyBeats: [],
    lorebookEntries: [],
    timeTracker: null,
  }
}

describe('changedFields', () => {
  it('keeps only fields whose value changes', () => {
    expect(
      changedFields(character('c', { name: 'A', traits: ['x'] }), { name: 'A', traits: ['y'] }),
    ).toEqual({ before: { traits: ['x'] }, after: { traits: ['y'] } })
  })

  it('ignores translations and timestamps', () => {
    expect(
      changedFields({ translatedName: 'a', updatedAt: 1 }, { translatedName: 'b', updatedAt: 2 }),
    ).toBeNull()
  })
})

describe('diffStates', () => {
  it('records a copy-on-write override as a create shadowing the parent', () => {
    const parent = character('p', { status: 'active' })
    const override = character('o', { status: 'deceased', overridesId: 'p', branchId: 'b' })
    const records = diffStates(state([parent]), state([override]), ctx)
    const { portrait: _portrait, ...recorded } = parent
    expect(records).toEqual([
      expect.objectContaining({ op: 'create', entityId: 'o', before: recorded, after: null }),
    ])
  })

  it('leaves portraits out of recorded rows and changes', () => {
    const before = character('c', { portrait: 'data:image/png;base64,AAAA' })
    const removed = diffStates(state([before]), state([]), ctx)
    expect(removed[0].before).not.toHaveProperty('portrait')
    const repainted = diffStates(
      state([before]),
      state([{ ...before, portrait: 'data:image/png;base64,BBBB' }]),
      ctx,
    )
    expect(repainted).toEqual([])
  })

  it('records an in-place change with its previous values', () => {
    const before = character('c', { relationship: 'ally' })
    const records = diffStates(state([before]), state([{ ...before, relationship: 'rival' }]), ctx)
    expect(records).toEqual([
      expect.objectContaining({ op: 'update', before: { relationship: 'ally' }, after: null }),
    ])
  })

  it('reverses to the state it was taken from', () => {
    const a = character('a', { relationship: 'ally' })
    const parent = character('p')
    const before = state([a, parent])
    const after = state([
      { ...a, relationship: 'rival' },
      character('o', { status: 'deceased', overridesId: 'p', branchId: 'b' }),
      character('n'),
    ])
    const records = diffStates(before, after, ctx).map((r, i) => ({ ...r, seq: i + 1 }))
    const plan = planReversal({
      state: after,
      records,
      entryPositions: new Map([['e1', 1]]),
      keep: { manual: false, tidy: false },
    })
    const ids = (s: TrackedState) => s.characters.map((c) => [c.id, c.relationship]).sort()
    expect(ids(plan.state)).toEqual(ids(before))
  })
})

describe('changeRecord', () => {
  it('keeps the new values, so a late change can be applied onto a saved state', () => {
    const record = changeRecord(
      { ...ctx, origin: 'chapter' },
      'lorebook_entry',
      'l',
      'update',
      { description: 'old' },
      { description: 'new' },
    )
    expect(record.after).toEqual({ description: 'new' })
  })
})
