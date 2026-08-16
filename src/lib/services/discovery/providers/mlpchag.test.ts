import { beforeEach, describe, expect, it, vi } from 'vitest'

const { corsFetchMock } = vi.hoisted(() => ({
  corsFetchMock: vi.fn(),
}))

vi.mock('../utils', () => ({
  corsFetch: corsFetchMock,
  GENERIC_ICON: 'generic-icon',
}))

import { MlpchagProvider } from './mlpchag'

describe('MlpchagProvider', () => {
  beforeEach(() => {
    corsFetchMock.mockReset()
  })

  it('loads the index, maps and filters a card, then serializes it for download', async () => {
    const fixture = {
      'Twilight Sparkle/Research Assistant.png': {
        name: 'Research Assistant',
        author: 'ArchiveAuthor',
        description: 'A careful magical researcher.',
        personality: 'Curious and precise.',
        scenario: 'A newly opened archive.',
        greetings: ['I catalogued the first shelf.', 'Ready for the next one?'],
        examples: '<START>\nAssistant: Cross-reference that volume.',
        creator_notes: 'Archive-compatible card.',
        system_prompt: 'Stay methodical.',
        post_history_instructions: 'Track discovered volumes.',
        character_version: '2.1',
        character_book: { name: 'Archive', entries: [] },
        tags: ['Unicorn', 'Research'],
        nsfw: false,
        datecreate: '2026-01-02',
      },
      'Other/Guard.png': {
        name: 'Night Guard',
        tags: ['Pegasus'],
      },
    }
    corsFetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue(fixture),
    } as unknown as Response)

    const provider = new MlpchagProvider()
    const result = await provider.search(
      {
        query: 'archiveauthor',
        page: 1,
        limit: 10,
        sort: 'new',
        tags: ['Research'],
      },
      'character',
    )

    expect(corsFetchMock).toHaveBeenCalledWith('https://mlpchag.neocities.org/mares.json')
    const expectedImageUrl =
      'https://mlpchag.neocities.org/cards/Twilight%20Sparkle/Research%20Assistant.png'
    expect(result).toEqual({
      cards: [
        {
          id: 'mlpchag_Twilight Sparkle/Research Assistant.png',
          name: 'Research Assistant',
          creator: 'ArchiveAuthor',
          description: 'A careful magical researcher.',
          avatarUrl: expectedImageUrl,
          imageUrl: expectedImageUrl,
          tags: ['Unicorn', 'Research'],
          stats: {},
          source: 'mlpchag',
          type: 'character',
          nsfw: false,
          raw: {
            ...fixture['Twilight Sparkle/Research Assistant.png'],
            _key: 'Twilight Sparkle/Research Assistant.png',
          },
        },
      ],
      hasMore: false,
      nextPage: undefined,
    })

    const card = result.cards[0]
    expect(await provider.getDownloadUrl(card)).toBe(expectedImageUrl)
    const blob = await provider.downloadCard(card)

    expect(blob.type).toBe('application/json')
    expect(JSON.parse(await blob.text())).toEqual({
      name: 'Research Assistant',
      description: 'A careful magical researcher.',
      personality: 'Curious and precise.',
      scenario: 'A newly opened archive.',
      first_mes: 'I catalogued the first shelf.',
      mes_example: '<START>\nAssistant: Cross-reference that volume.',
      creator_notes: 'Archive-compatible card.',
      system_prompt: 'Stay methodical.',
      post_history_instructions: 'Track discovered volumes.',
      alternate_greetings: ['Ready for the next one?'],
      tags: ['Unicorn', 'Research'],
      creator: 'ArchiveAuthor',
      character_version: '2.1',
      character_book: { name: 'Archive', entries: [] },
    })
  })
})
