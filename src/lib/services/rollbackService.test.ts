import { describe, it, expect, vi, beforeEach } from 'vitest'

// Statement builders return a tag naming the call, so the transaction can be read back.
const { tag } = vi.hoisted(() => ({
  tag:
    (name: string) =>
    (...args: unknown[]) => ({ sql: name, params: args }),
}))

vi.mock('./database', () => ({
  database: {
    transaction: vi.fn(),
    deleteWorldStateSnapshotsAfter: vi.fn(),
    cleanupNoopOverrides: vi.fn().mockResolvedValue(0),
    saveTimeTrackerStatement: tag('saveTimeTracker'),
    clearTimeTrackerStatement: tag('clearTimeTracker'),
    deleteCharacterStatement: tag('deleteCharacter'),
    deleteLocationStatement: tag('deleteLocation'),
    deleteItemStatement: tag('deleteItem'),
    deleteStoryBeatStatement: tag('deleteStoryBeat'),
    deleteEntryStatement: tag('deleteEntry'),
    markCharacterDeletedStatement: tag('markCharacterDeleted'),
    markLocationDeletedStatement: tag('markLocationDeleted'),
    markItemDeletedStatement: tag('markItemDeleted'),
    markStoryBeatDeletedStatement: tag('markStoryBeatDeleted'),
    markEntryDeletedStatement: tag('markEntryDeleted'),
    updateCharacterStatement: tag('updateCharacter'),
    updateLocationStatement: tag('updateLocation'),
    updateItemStatement: tag('updateItem'),
    updateStoryBeatStatement: tag('updateStoryBeat'),
    updateEntryStatement: tag('updateEntry'),
    addCharacterStatement: tag('addCharacter'),
    addLocationStatement: tag('addLocation'),
    addItemStatement: tag('addItem'),
    addStoryBeatStatement: tag('addStoryBeat'),
    addEntryStatement: tag('addEntry'),
  },
}))

import { rollbackService, type RollbackInput } from './rollbackService'
import { database } from './database'
import type { StoryEntry, WorldStateRecord } from '#lib/types/index.ts'

function statements(): { sql: string; params: unknown[] }[] {
  return vi.mocked(database.transaction).mock.calls[0][0] as never
}

const state = {
  characters: [
    { id: 'c-old', name: 'Aria', status: 'active', relationship: 'rival', traits: [] },
    { id: 'c-new', name: 'New' },
  ],
  locations: [
    { id: 'loc-1', current: false },
    { id: 'loc-2', current: true },
  ],
  items: [],
  storyBeats: [],
  lorebookEntries: [{ id: 'lore', description: 'later' }],
  timeTracker: { years: 0, days: 3, hours: 0, minutes: 0 },
} as unknown as RollbackInput['state']

const legacyEntry = {
  id: 'e5',
  storyId: 'story-1',
  branchId: null,
  position: 5,
  type: 'narration',
  content: 'Entry 5',
  createdAt: 5,
  worldStateDelta: {
    classificationResult: {},
    createdEntities: { characterIds: ['c-new'], locationIds: [], itemIds: [], storyBeatIds: [] },
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
  },
} as unknown as StoryEntry

function input(overrides: Partial<RollbackInput>): RollbackInput {
  return {
    storyId: 'story-1',
    branchId: null,
    fromPosition: 5,
    entries: [legacyEntry],
    state,
    records: [],
    keepManual: false,
    ...overrides,
  }
}

describe('RollbackService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes nothing when no entry is at or after the position', async () => {
    const summary = await rollbackService.rollbackFromPosition(input({ fromPosition: 9 }))
    expect(summary.entriesProcessed).toBe(0)
    expect(statements()).toEqual([])
  })

  it('undoes an older world_state_delta in one transaction', async () => {
    const summary = await rollbackService.rollbackFromPosition(input({}))

    expect(summary.entriesWithRecords).toBe(1)
    expect(database.transaction).toHaveBeenCalledTimes(1)
    const sql = statements()
    expect(sql).toContainEqual({ sql: 'deleteCharacter', params: ['c-new'] })
    expect(sql).toContainEqual({
      sql: 'updateCharacter',
      params: ['c-old', expect.objectContaining({ relationship: 'ally' })],
    })
    expect(sql).toContainEqual({ sql: 'updateLocation', params: ['loc-1', { current: true }] })
    expect(sql).toContainEqual({ sql: 'clearTimeTracker', params: ['story-1'] })
  })

  it('undoes change records, the lorebook included', async () => {
    const records: WorldStateRecord[] = [
      {
        id: 'r1',
        storyId: 'story-1',
        branchId: null,
        entryId: 'e6',
        seq: 1,
        createdAt: 6,
        kind: 'change',
        origin: 'agent',
        entityType: 'lorebook_entry',
        entityId: 'lore',
        op: 'update',
        before: { description: 'earlier' },
        after: null,
      },
    ]
    const entry = { ...legacyEntry, id: 'e6', position: 6, worldStateDelta: null }
    await rollbackService.rollbackFromPosition(
      input({ entries: [entry], records, fromPosition: 6 }),
    )
    expect(statements()).toEqual([
      { sql: 'updateEntry', params: ['lore', { description: 'earlier' }] },
    ])
  })

  it('writes nothing and cleans nothing up when the transaction fails', async () => {
    vi.mocked(database.transaction).mockRejectedValueOnce(new Error('disk full'))
    await expect(rollbackService.rollbackFromPosition(input({}))).rejects.toThrow('disk full')
    expect(database.deleteWorldStateSnapshotsAfter).not.toHaveBeenCalled()
  })
})
