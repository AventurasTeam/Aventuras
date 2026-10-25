import { describe, it, expect, vi } from 'vitest'
import { WorldStateTranslationService } from './WorldStateTranslationService'
import type { Character } from '#lib/types/index.ts'

describe('WorldStateTranslationService', () => {
  it('returns translatedCount 0 when no written character is found', async () => {
    const translateUIElements = vi.fn()
    const service = new WorldStateTranslationService({ translateUIElements })

    const res = await service.translateEntities(
      {
        storyId: 'story-1',
        classificationResult: {
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
        characters: [{ id: 'gone', fields: 'all' }],
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
        characters: [{ id: 'c1', fields: 'all' }],
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

  it('translates the fields the classification changed, and only those', async () => {
    const translateUIElements = vi
      .fn()
      .mockImplementation(async (items) =>
        items.map((item: any) => ({ ...item, text: `[IT] ${item.text}` })),
      )
    const updateCharacter = vi.fn()
    const service = new WorldStateTranslationService({ translateUIElements })
    const rewritten = {
      id: 'c1',
      name: 'Aria',
      translatedName: 'Aria',
      description: 'A healed warrior',
      translatedDescription: null,
      relationship: 'ally',
      translatedRelationship: 'alleata',
      traits: ['brave'],
      translatedTraits: ['coraggiosa'],
      visualDescriptors: {},
    } as unknown as Character

    const res = await service.translateEntities(
      {
        storyId: 'story-1',
        classificationResult: {
          newLocations: [],
          newItems: [],
          newStoryBeats: [],
        },
        worldState: { characters: [rewritten], locations: [], items: [], storyBeats: [] },
        targetLanguage: 'it',
        characters: [{ id: 'c1', fields: ['description'] }],
      },
      {
        updateCharacter,
        updateLocation: vi.fn(),
        updateItem: vi.fn(),
        updateStoryBeat: vi.fn(),
        refreshWorldState: vi.fn(),
      },
    )

    expect(res.translatedCount).toBe(1)
    expect(updateCharacter).toHaveBeenCalledExactlyOnceWith('c1', {
      translatedDescription: '[IT] A healed warrior',
      translationLanguage: 'it',
    })
  })

  describe('traits and appearance', () => {
    const mira = {
      id: 'm1',
      name: 'Mira',
      translatedName: 'Mira',
      description: null,
      relationship: null,
      traits: ['fiercely loyal, even to a fault', 'wry'],
      visualDescriptors: { hair: 'silver braid', eyes: 'grey' },
    } as unknown as Character

    function run(
      translate: (items: any[]) => any[],
      getCharacter?: (id: string) => Character | undefined,
    ) {
      const updateCharacter = vi.fn()
      const service = new WorldStateTranslationService({
        translateUIElements: vi.fn().mockImplementation(async (items) => translate(items)),
      })
      const done = service.translateEntities(
        {
          storyId: 'story-1',
          classificationResult: {
            newLocations: [],
            newItems: [],
            newStoryBeats: [],
          },
          worldState: { characters: [mira], locations: [], items: [], storyBeats: [] },
          targetLanguage: 'it',
          characters: [{ id: 'm1', fields: ['traits', 'visualDescriptors'] }],
        },
        {
          updateCharacter,
          getCharacter,
          updateLocation: vi.fn(),
          updateItem: vi.fn(),
          updateStoryBeat: vi.fn(),
          refreshWorldState: vi.fn(),
        },
      )
      return done.then(() => updateCharacter)
    }
    const tag = (items: any[]) => items.map((i) => ({ ...i, text: `[IT] ${i.text}` }))

    it('writes the appearance as categories and each trait whole', async () => {
      const updateCharacter = await run(tag)
      expect(updateCharacter).toHaveBeenCalledWith('m1', {
        translatedTraits: ['[IT] fiercely loyal, even to a fault', '[IT] wry'],
        translationLanguage: 'it',
      })
      expect(updateCharacter).toHaveBeenCalledWith('m1', {
        translatedVisualDescriptors: { hair: '[IT] silver braid', eyes: '[IT] grey' },
        translationLanguage: 'it',
      })
    })

    it('writes nothing for a field the translator answered only in part', async () => {
      const updateCharacter = await run((items) =>
        tag(items.filter((i) => i.id !== 'm1:visual:eyes')),
      )
      expect(updateCharacter).toHaveBeenCalledTimes(1)
      expect(updateCharacter.mock.calls[0][1]).toHaveProperty('translatedTraits')
    })

    it('writes nothing over text that changed while it was translated', async () => {
      const reverted = { ...mira, traits: ['wry'] } as Character
      const updateCharacter = await run(tag, () => reverted)
      expect(updateCharacter).toHaveBeenCalledExactlyOnceWith('m1', {
        translatedVisualDescriptors: { hair: '[IT] silver braid', eyes: '[IT] grey' },
        translationLanguage: 'it',
      })
    })

    it('writes nothing for a character that is gone', async () => {
      const updateCharacter = await run(tag, () => undefined)
      expect(updateCharacter).not.toHaveBeenCalled()
    })
  })
})
