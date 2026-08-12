import { describe, it, expect, vi } from 'vitest'
import { WorldStateTranslationService } from './WorldStateTranslationService'
import type { Character } from '$lib/types'

describe('WorldStateTranslationService', () => {
  it('returns translatedCount 0 when no matching entities are found', async () => {
    const translateUIElements = vi.fn()
    const service = new WorldStateTranslationService({ translateUIElements })

    const res = await service.translateEntities(
      {
        storyId: 'story-1',
        classificationResult: {
          newCharacters: [{ name: 'Gareth', description: 'Missing rogue' }],
          newLocations: [],
          newItems: [],
          newStoryBeats: [],
        },
        worldState: {
          characters: [],
          locations: [],
          items: [],
          storyBeats: [],
        },
        targetLanguage: 'it',
      },
      {
        updateCharacter: vi.fn(),
        updateLocation: vi.fn(),
        updateItem: vi.fn(),
        updateStoryBeat: vi.fn(),
        refreshWorldState: vi.fn(),
      },
    )

    expect(res.translatedCount).toBe(0)
    expect(translateUIElements).not.toHaveBeenCalled()
  })

  it('translates matching characters and invokes callbacks', async () => {
    const translateUIElements = vi.fn().mockImplementation(async (items) => {
      return items.map((item: any) => ({
        ...item,
        text: `[IT] ${item.text}`,
      }))
    })

    const updateCharacter = vi.fn()
    const refreshWorldState = vi.fn()

    const service = new WorldStateTranslationService({ translateUIElements })

    const mockChar: Character = {
      id: 'c1',
      name: 'Aria',
      description: 'Brave warrior',
    } as any

    const res = await service.translateEntities(
      {
        storyId: 'story-1',
        classificationResult: {
          newCharacters: [{ name: 'Aria', description: 'Brave warrior' }],
          newLocations: [],
          newItems: [],
          newStoryBeats: [],
        },
        worldState: {
          characters: [mockChar],
          locations: [],
          items: [],
          storyBeats: [],
        },
        targetLanguage: 'it',
      },
      {
        updateCharacter,
        updateLocation: vi.fn(),
        updateItem: vi.fn(),
        updateStoryBeat: vi.fn(),
        refreshWorldState,
      },
    )

    expect(res.translatedCount).toBe(2)
    expect(updateCharacter).toHaveBeenCalledWith('c1', {
      translatedName: '[IT] Aria',
      translationLanguage: 'it',
    })
    expect(updateCharacter).toHaveBeenCalledWith('c1', {
      translatedDescription: '[IT] Brave warrior',
      translationLanguage: 'it',
    })
    expect(refreshWorldState).toHaveBeenCalled()
  })
})
