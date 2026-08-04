import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./database', () => ({
  database: {
    clearTimeTracker: vi.fn(),
    saveTimeTracker: vi.fn(),
    setCurrentLocation: vi.fn(),
    deleteWorldStateSnapshotsAfter: vi.fn(),
    cleanupNoopOverrides: vi.fn(),
    deleteCharacter: vi.fn(),
    deleteLocation: vi.fn(),
    deleteItem: vi.fn(),
    deleteStoryBeat: vi.fn(),
    updateCharacter: vi.fn(),
    updateLocation: vi.fn(),
    updateItem: vi.fn(),
    updateStoryBeat: vi.fn(),
    getLocationsForBranch: vi.fn(),
  },
}))

import { rollbackService } from './rollbackService'
import { database } from './database'
import type { StoryEntry } from '$lib/types'

describe('RollbackService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty summary when no entries exist at or above fromPosition', async () => {
    const entries: StoryEntry[] = [
      { id: '1', position: 1, type: 'narration', content: 'Entry 1' } as any,
    ]

    const summary = await rollbackService.rollbackFromPosition('story-1', null, 5, entries)
    expect(summary.entriesProcessed).toBe(0)
    expect(summary.deletedCharacters).toBe(0)
  })

  it('deletes created entities and restores updated ones for deltas', async () => {
    const entries: StoryEntry[] = [
      {
        id: '2',
        position: 5,
        type: 'narration',
        content: 'Entry 5',
        worldStateDelta: {
          createdEntities: {
            characterIds: ['c-new'],
            locationIds: [],
            itemIds: [],
            storyBeatIds: [],
          },
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
      } as any,
    ]

    const summary = await rollbackService.rollbackFromPosition('story-1', null, 5, entries)

    expect(summary.entriesProcessed).toBe(1)
    expect(summary.entriesWithDelta).toBe(1)
    expect(database.deleteCharacter).toHaveBeenCalledWith('c-new')
    expect(database.updateCharacter).toHaveBeenCalledWith(
      'c-old',
      expect.objectContaining({ status: 'active' }),
    )
    expect(database.setCurrentLocation).toHaveBeenCalledWith('story-1', 'loc-1')
    expect(database.clearTimeTracker).toHaveBeenCalledWith('story-1')
  })
})
