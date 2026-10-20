import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { StoryEntry, WorldStateDelta } from '#lib/types/index.ts'
import { RECORD_COLUMNS, fromWorldStateDelta, planReversal, recordToRow } from '.'

interface Fixture {
  entries: (Pick<StoryEntry, 'id' | 'storyId' | 'branchId' | 'position' | 'createdAt'> & {
    worldStateDelta: WorldStateDelta | string | null
  })[]
  existing: { entry_id: string; kind: string }[]
  converted: Record<string, unknown>[]
}

// Shared with the cargo test of migration 041, so the two conversions cannot drift.
const fixture: Fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('./legacy-deltas.fixture.json', import.meta.url)), 'utf-8'),
)

describe('the golden fixture', () => {
  const headed = new Set(fixture.existing.filter((r) => r.kind === 'header').map((r) => r.entry_id))
  // An invalid delta and one beside a header of its own exist only in a database.
  const converted = fixture.entries
    .filter((e) => typeof e.worldStateDelta === 'object' && e.worldStateDelta && !headed.has(e.id))
    .flatMap((e) =>
      fromWorldStateDelta(e as unknown as StoryEntry, e.worldStateDelta as WorldStateDelta),
    )
    .map((record) => {
      const values = recordToRow(record)
      const row = Object.fromEntries(RECORD_COLUMNS.map((c, i) => [c, values[i]]))
      const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v)
      return { ...row, before: parse(row.before), after: parse(row.after) }
    })

  it('is what fromWorldStateDelta produces, row for row and in order', () => {
    expect(converted).toEqual(fixture.converted)
  })
})

const entry = {
  id: 'e5',
  storyId: 's',
  branchId: null,
  position: 5,
  type: 'narration',
  content: '',
  createdAt: 100,
} as unknown as StoryEntry

// The scene moved from loc-1 to loc-2: the old classifier kept loc-2's before-state and only the
// id of the scene it left.
const delta: WorldStateDelta = {
  classificationResult: {},
  previousState: {
    characters: [
      {
        id: 'c-old',
        name: 'Aria',
        status: 'active',
        relationship: 'ally',
        traits: ['brave'],
        visualDescriptors: {},
      },
    ],
    locations: [{ id: 'loc-2', name: 'Docks', visited: false, current: false, description: null }],
    items: [],
    storyBeats: [],
    currentLocationId: 'loc-1',
    timeTracker: null,
  },
  createdEntities: { characterIds: ['c-new'], locationIds: [], itemIds: [], storyBeatIds: [] },
}

const withScene = (currentLocationId: unknown, locations = delta.previousState.locations) =>
  ({
    ...delta,
    previousState: { ...delta.previousState, locations, currentLocationId },
  }) as WorldStateDelta

const sceneRecords = (d: WorldStateDelta) =>
  fromWorldStateDelta(entry, d).filter(
    (r) => r.kind === 'change' && r.entityType === 'location' && r.entityId === 'loc-1',
  )

describe('fromWorldStateDelta', () => {
  const records = fromWorldStateDelta(entry, delta)

  it('marks the history as classifier-only', () => {
    expect(records[0]).toMatchObject({ kind: 'header', coverage: 'classifier', continuous: false })
  })

  it('does not carry the name into the restored fields', () => {
    const update = records.find((r) => r.kind === 'change' && r.entityId === 'c-old')
    expect(update).toMatchObject({ op: 'update', origin: 'classifier' })
    expect(update?.kind === 'change' && update.before).toEqual({
      status: 'active',
      relationship: 'ally',
      traits: ['brave'],
      visualDescriptors: {},
    })
  })

  it('records the scene it left as a location regaining its flag, before the creates', () => {
    expect(records.map((r) => r.id)).toEqual(['e5:header', 'e5:1', 'e5:2', 'e5:3', 'e5:4'])
    expect(records[3]).toMatchObject({
      kind: 'change',
      origin: 'classifier',
      entityType: 'location',
      entityId: 'loc-1',
      op: 'update',
      before: { current: true },
      after: null,
    })
    expect(records[4]).toMatchObject({ entityId: 'c-new', op: 'create' })
  })

  it('records no scene when there was none, the field is absent, or its before-state is listed', () => {
    expect(sceneRecords(withScene(null))).toEqual([])
    expect(sceneRecords(withScene(undefined))).toEqual([])
    const listed = [
      ...delta.previousState.locations,
      { id: 'loc-1', name: 'Inn', visited: true, current: true, description: null },
    ]
    expect(sceneRecords(withScene('loc-1', listed))).toMatchObject([
      { op: 'update', before: { visited: true, current: true, description: null } },
    ])
  })

  it('reverts a scene move to the earlier scene alone', () => {
    const plan = planReversal({
      state: {
        characters: [
          {
            id: 'c-old',
            name: 'Aria',
            relationship: 'rival',
            status: 'active',
            traits: [],
          } as never,
          { id: 'c-new', name: 'New' } as never,
        ],
        locations: [
          { id: 'loc-1', current: false, visited: true } as never,
          { id: 'loc-2', current: true, visited: true } as never,
        ],
        items: [],
        storyBeats: [],
        lorebookEntries: [],
        timeTracker: { years: 0, days: 3, hours: 0, minutes: 0 },
      },
      records,
      entryPositions: new Map([['e5', 5]]),
      keep: { manual: false, tidy: false },
    })
    expect(plan.state.characters.map((c) => [c.id, c.relationship])).toEqual([['c-old', 'ally']])
    expect(plan.state.locations.filter((l) => l.current).map((l) => l.id)).toEqual(['loc-1'])
    expect(plan.state.locations.find((l) => l.id === 'loc-2')?.visited).toBe(false)
    // The clock comes from the entries, not from the delta's recorded one.
    expect(plan.state.timeTracker?.days).toBe(3)
  })
})
