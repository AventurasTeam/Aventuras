import { describe, expect, it } from 'vitest'
import type {
  Character,
  ChangeOp,
  ChangeOrigin,
  TrackedEntityType,
  WorldStateChangeRecord,
  WorldStateHeaderRecord,
} from '$lib/types'
import { planReversal, type TrackedState } from '.'

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
    timeTracker: { years: 0, days: 2, hours: 0, minutes: 0 },
  }
}

let seq = 0
function change(
  entryId: string,
  op: ChangeOp,
  entityId: string,
  before: Record<string, unknown> | null,
  opts: { origin?: ChangeOrigin; after?: Record<string, unknown>; type?: TrackedEntityType } = {},
): WorldStateChangeRecord {
  seq++
  return {
    id: `r${seq}`,
    storyId: 's',
    branchId: null,
    entryId,
    seq,
    createdAt: seq,
    kind: 'change',
    origin: opts.origin ?? 'agent',
    entityType: opts.type ?? 'character',
    entityId,
    op,
    before,
    after: opts.after ?? null,
  }
}

function header(entryId: string, clockDays: number): WorldStateHeaderRecord {
  seq++
  return {
    id: `h${seq}`,
    storyId: 's',
    branchId: null,
    entryId,
    seq,
    createdAt: seq,
    kind: 'header',
    continuous: true,
    clockBefore: { years: 0, days: clockDays, hours: 0, minutes: 0 },
    locationBefore: null,
    coverage: 'full',
  }
}

const positions = new Map([
  ['e1', 1],
  ['e2', 2],
  ['e3', 3],
])

describe('planReversal', () => {
  it('leaves the earliest recorded value of a field standing', () => {
    const plan = planReversal({
      state: state([character('c', { relationship: 'C' })]),
      records: [
        change('e2', 'update', 'c', { relationship: 'B' }),
        change('e1', 'update', 'c', { relationship: 'A' }),
      ],
      entryPositions: positions,
      keepManual: false,
    })
    expect(plan.state.characters[0].relationship).toBe('A')
  })

  it('cancels a create followed by a delete', () => {
    const created = character('n')
    const plan = planReversal({
      state: state([]),
      records: [change('e1', 'create', 'n', null), change('e2', 'delete', 'n', { ...created })],
      entryPositions: positions,
      keepManual: false,
    })
    expect(plan.state.characters).toEqual([])
  })

  it('restores a deleted row under its id', () => {
    const gone = character('g', { description: 'kept' })
    const plan = planReversal({
      state: state([]),
      records: [change('e1', 'softDelete', 'g', { ...gone, deleted: true })],
      entryPositions: positions,
      keepManual: false,
    })
    expect(plan.state.characters).toEqual([{ ...gone, deleted: false }])
    expect(plan.ops).toContainEqual({
      kind: 'restore',
      entityType: 'character',
      row: { ...gone, deleted: false },
    })
  })

  it('brings back the row an undone override was shadowing', () => {
    const parent = character('p', { relationship: 'old' })
    const override = character('o', { relationship: 'new', overridesId: 'p', branchId: 'b' })
    const plan = planReversal({
      state: state([override]),
      records: [change('e1', 'create', 'o', { ...parent })],
      entryPositions: positions,
      keepManual: false,
    })
    expect(plan.state.characters.map((c) => c.id)).toEqual(['p'])
    expect(plan.ops).toEqual([{ kind: 'delete', entityType: 'character', id: 'o' }])
  })

  it('restores the clock from the earliest header in range', () => {
    const plan = planReversal({
      state: state([]),
      records: [header('e3', 9), header('e2', 5)],
      entryPositions: positions,
      keepManual: false,
    })
    expect(plan.state.timeTracker?.days).toBe(5)
  })

  it('keeps a manual edit made over an automatic one', () => {
    const plan = planReversal({
      state: state([character('c', { relationship: 'C' })]),
      records: [
        change('e2', 'update', 'c', { relationship: 'A' }),
        change('e3', 'update', 'c', { relationship: 'B' }, { origin: 'manual', after: { relationship: 'C' } }),
      ],
      entryPositions: positions,
      keepManual: true,
    })
    expect(plan.state.characters[0].relationship).toBe('C')
    expect(plan.manual).toHaveLength(1)
    expect(plan.unkeepable).toEqual([])
  })

  it('undoes manual edits when they are not kept', () => {
    const plan = planReversal({
      state: state([character('c', { relationship: 'C' })]),
      records: [
        change('e3', 'update', 'c', { relationship: 'B' }, { origin: 'manual', after: { relationship: 'C' } }),
      ],
      entryPositions: positions,
      keepManual: false,
    })
    expect(plan.state.characters[0].relationship).toBe('B')
    expect(plan.manual).toHaveLength(1)
  })

  it('cannot keep a manual edit to an entity created in the range', () => {
    const edit = change('e3', 'update', 'n', { description: null }, {
      origin: 'manual',
      after: { description: 'x' },
    })
    const plan = planReversal({
      state: state([character('n', { description: 'x' })]),
      records: [change('e2', 'create', 'n', null), edit],
      entryPositions: positions,
      keepManual: true,
    })
    expect(plan.state.characters).toEqual([])
    expect(plan.unkeepable).toEqual([edit])
  })

  it('keeps a manual edit to an override by writing the override again', () => {
    const parent = character('p', { description: 'parent' })
    const override = character('o', { description: 'mine', overridesId: 'p', branchId: 'b' })
    const plan = planReversal({
      state: state([override]),
      records: [
        change('e2', 'create', 'o', { ...parent }),
        change('e3', 'update', 'o', { description: 'parent' }, {
          origin: 'manual',
          after: { description: 'mine' },
        }),
      ],
      entryPositions: positions,
      keepManual: true,
    })
    expect(plan.state.characters).toEqual([
      expect.objectContaining({ id: 'o', description: 'mine', overridesId: 'p' }),
    ])
    expect(plan.unkeepable).toEqual([])
  })
})
