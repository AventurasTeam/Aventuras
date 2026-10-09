import { describe, expect, it } from 'vitest'
import type { StoryEntry, WorldStateDelta } from '$lib/types'
import { fromWorldStateDelta, planReversal } from '.'

const entry = {
  id: 'e5',
  storyId: 's',
  branchId: null,
  position: 5,
  type: 'narration',
  content: '',
  createdAt: 100,
} as unknown as StoryEntry

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
    locations: [],
    items: [],
    storyBeats: [],
    currentLocationId: 'loc-1',
    timeTracker: null,
  },
  createdEntities: { characterIds: ['c-new'], locationIds: [], itemIds: [], storyBeatIds: [] },
}

describe('fromWorldStateDelta', () => {
  const records = fromWorldStateDelta(entry, delta)

  it('marks the history as classifier-only', () => {
    expect(records[0]).toMatchObject({ kind: 'header', coverage: 'classifier', continuous: false })
  })

  it('does not carry the name into the restored fields', () => {
    const update = records.find((r) => r.kind === 'change' && r.op === 'update')
    expect(update).toMatchObject({ entityId: 'c-old', origin: 'agent' })
    expect(update?.kind === 'change' && update.before).toEqual({
      status: 'active',
      relationship: 'ally',
      traits: ['brave'],
      visualDescriptors: {},
    })
  })

  it('reverts like the rollback it replaces', () => {
    const plan = planReversal({
      state: {
        characters: [
          { id: 'c-old', name: 'Aria', relationship: 'rival', status: 'active', traits: [] } as never,
          { id: 'c-new', name: 'New' } as never,
        ],
        locations: [
          { id: 'loc-1', current: false } as never,
          { id: 'loc-2', current: true } as never,
        ],
        items: [],
        storyBeats: [],
        lorebookEntries: [],
        timeTracker: { years: 0, days: 3, hours: 0, minutes: 0 },
      },
      records,
      entryPositions: new Map([['e5', 5]]),
      keepManual: false,
    })
    expect(plan.state.characters.map((c) => [c.id, c.relationship])).toEqual([['c-old', 'ally']])
    expect(plan.state.locations.find((l) => l.current)?.id).toBe('loc-1')
    expect(plan.state.timeTracker).toBeNull()
  })
})
