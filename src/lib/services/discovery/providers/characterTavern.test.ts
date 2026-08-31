import { beforeEach, describe, expect, it, vi } from 'vitest'

const { corsFetchMock } = vi.hoisted(() => ({
  corsFetchMock: vi.fn(),
}))

vi.mock('../utils', () => ({
  corsFetch: corsFetchMock,
}))

import { CharacterTavernProvider } from './characterTavern'

describe('CharacterTavernProvider', () => {
  beforeEach(() => {
    corsFetchMock.mockReset()
  })

  it('searches with the requested filters and maps safe results', async () => {
    const safeHit = {
      id: 'ct-17',
      name: 'Captain Rowan',
      inChatName: 'Rowan',
      author: 'tavern-keeper',
      tagline: 'An airship captain looking for a crew.',
      path: 'tavern-keeper/captain-rowan',
      tags: ['Adventure', 'Steampunk'],
      downloads: 70,
      views: 120,
      likes: 11,
      isNSFW: false,
      characterDefinition: 'A seasoned captain.',
      characterPersonality: 'Decisive and warm.',
      characterScenario: 'The airship leaves at dawn.',
      characterFirstMessage: 'Welcome aboard.',
      characterExampleMessages: '<START>\nRowan: Cast off.',
      characterPostHistoryPrompt: 'Keep the voyage moving.',
      alternativeFirstMessage: ['You made it.'],
    }
    const unsafeHit = {
      id: 'ct-18',
      name: 'Filtered Result',
      tags: ['NSFW'],
      isNSFW: false,
    }
    corsFetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        hits: [safeHit, unsafeHit],
        totalPages: 4,
        page: 2,
      }),
    } as unknown as Response)

    const provider = new CharacterTavernProvider()
    const result = await provider.search(
      {
        query: 'airship captain',
        limit: 12,
        page: 2,
        tags: ['Adventure', 'Steampunk'],
        nsfw: false,
      },
      'character',
    )

    const [requestUrl, init] = corsFetchMock.mock.calls[0] as [string, RequestInit]
    const url = new URL(requestUrl)
    expect(`${url.origin}${url.pathname}`).toBe('https://character-tavern.com/api/search/cards')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: 'airship captain',
      limit: '12',
      page: '2',
      tags: 'Adventure,Steampunk',
    })
    expect(init).toEqual({ headers: { Accept: 'application/json' } })
    expect(init.method).toBeUndefined()
    expect(init.body).toBeUndefined()

    expect(result).toEqual({
      cards: [
        {
          id: 'ct-17',
          name: 'Captain Rowan',
          creator: 'tavern-keeper',
          description: 'An airship captain looking for a crew.',
          avatarUrl: 'https://cards.character-tavern.com/tavern-keeper/captain-rowan.png',
          imageUrl: 'https://cards.character-tavern.com/tavern-keeper/captain-rowan.png',
          tags: ['Adventure', 'Steampunk'],
          stats: { downloads: 70, views: 120, rating: 11 },
          source: 'character_tavern',
          type: 'character',
          nsfw: false,
          raw: safeHit,
        },
      ],
      hasMore: true,
      nextPage: 3,
    })
  })

  it('returns the card image URL and serializes the complete Tavern payload', async () => {
    const provider = new CharacterTavernProvider()
    const raw = {
      path: 'tavern-keeper/captain-rowan',
      tagline: 'An airship captain looking for a crew.',
      characterDefinition: 'A seasoned captain.',
      characterPersonality: 'Decisive and warm.',
      characterScenario: 'The airship leaves at dawn.',
      characterFirstMessage: 'Welcome aboard.',
      characterExampleMessages: '<START>\nRowan: Cast off.',
      characterPostHistoryPrompt: 'Keep the voyage moving.',
      alternativeFirstMessage: ['You made it.'],
    }
    const card = {
      id: 'ct-17',
      name: 'Captain Rowan',
      creator: 'tavern-keeper',
      description: 'An airship captain looking for a crew.',
      avatarUrl: 'https://cards.character-tavern.com/tavern-keeper/captain-rowan.png',
      imageUrl: 'https://cards.character-tavern.com/tavern-keeper/captain-rowan.png',
      tags: ['Adventure', 'Steampunk'],
      source: 'character_tavern',
      type: 'character' as const,
      nsfw: false,
      raw,
    }

    expect(await provider.getDownloadUrl(card)).toBe(card.imageUrl)
    const blob = await provider.downloadCard(card)

    expect(corsFetchMock).not.toHaveBeenCalled()
    expect(blob.type).toBe('application/json')
    expect(JSON.parse(await blob.text())).toEqual({
      name: 'Captain Rowan',
      description: 'A seasoned captain.',
      personality: 'Decisive and warm.',
      scenario: 'The airship leaves at dawn.',
      first_mes: 'Welcome aboard.',
      mes_example: '<START>\nRowan: Cast off.',
      creator_notes: 'An airship captain looking for a crew.',
      system_prompt: 'Keep the voyage moving.',
      post_history_instructions: 'Keep the voyage moving.',
      alternate_greetings: ['You made it.'],
      tags: ['Adventure', 'Steampunk'],
      creator: 'tavern-keeper',
      character_version: '',
      extensions: {
        character_tavern: { id: 'ct-17', path: 'tavern-keeper/captain-rowan' },
      },
    })
  })
})
