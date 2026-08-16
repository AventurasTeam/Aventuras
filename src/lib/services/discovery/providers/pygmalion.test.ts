import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DiscoveryCard } from '../types'
import { PygmalionProvider } from './pygmalion'

const mocks = vi.hoisted(() => ({
  corsFetch: vi.fn(),
}))

vi.mock('../utils', () => ({
  corsFetch: mocks.corsFetch,
  GENERIC_ICON: 'generic-icon',
}))

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('PygmalionProvider', () => {
  beforeEach(() => {
    mocks.corsFetch.mockReset()
  })

  it('searches the Connect RPC endpoint and maps a character result', async () => {
    const raw = {
      id: 'pyg-42',
      displayName: 'Aster Vale',
      owner: { displayName: 'Mira', username: 'mira-fallback' },
      description: 'An astronomer following a vanished constellation.',
      avatarUrl: 'https://cdn.pygmalion.chat/aster.webp',
      tags: ['astronomy', 'mystery'],
      downloads: 321,
      views: 654,
      stars: 4.75,
    }
    mocks.corsFetch.mockResolvedValueOnce(jsonResponse({ characters: [raw] }))

    const provider = new PygmalionProvider()
    const result = await provider.search(
      { query: 'Aster Vale', page: 2, limit: 25, sort: 'popular', nsfw: false },
      'character',
    )

    expect(mocks.corsFetch).toHaveBeenCalledOnce()
    expect(mocks.corsFetch).toHaveBeenCalledWith(
      'https://server.pygmalion.chat/galatea.v1.PublicCharacterService/CharacterSearch',
      {
        method: 'POST',
        headers: {
          Accept: '*/*',
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
        },
        body: JSON.stringify({
          orderBy: 'downloads',
          orderDescending: true,
          includeSensitive: false,
          pageSize: 25,
          page: 1,
          query: 'Aster Vale',
        }),
      },
    )
    expect(result).toEqual({
      cards: [
        {
          id: 'pyg-42',
          name: 'Aster Vale',
          creator: 'Mira',
          description: 'An astronomer following a vanished constellation.',
          avatarUrl: 'https://cdn.pygmalion.chat/aster.webp',
          imageUrl: 'https://cdn.pygmalion.chat/aster.webp',
          tags: ['astronomy', 'mystery'],
          stats: { downloads: 321, views: 654, rating: 4.75 },
          source: 'pygmalion',
          type: 'character',
          nsfw: false,
          raw,
        },
      ],
      hasMore: false,
      nextPage: undefined,
    })
  })

  it('resolves its public page and downloads normalized character JSON', async () => {
    const card = {
      id: 'pyg-42',
      name: 'Aster Vale',
      creator: 'Mira',
      description: 'Search description',
      avatarUrl: '',
      tags: [],
      source: 'pygmalion',
      type: 'character',
      nsfw: false,
    } satisfies DiscoveryCard
    mocks.corsFetch.mockResolvedValueOnce(
      jsonResponse({
        character: {
          id: 'pyg-42',
          displayName: 'Aster Vale',
          description: 'Creator notes',
          tags: ['astronomy'],
          owner: { displayName: 'Mira' },
          versionLabel: '2.1',
          personality: {
            name: 'Aster',
            persona: 'Patient, precise, and intensely curious.',
            greeting: 'The observatory is usually quieter at this hour.',
            creator: 'Mira Prime',
          },
        },
      }),
    )

    const provider = new PygmalionProvider()
    await expect(provider.getDownloadUrl(card)).resolves.toBe('https://pygmalion.chat/chat/pyg-42')
    const blob = await provider.downloadCard(card)

    expect(mocks.corsFetch).toHaveBeenCalledWith(
      'https://server.pygmalion.chat/galatea.v1.PublicCharacterService/Character',
      {
        method: 'POST',
        headers: {
          Accept: '*/*',
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
        },
        body: JSON.stringify({ characterMetaId: 'pyg-42' }),
      },
    )
    expect(blob.type).toBe('application/json')
    await expect(blob.text().then(JSON.parse)).resolves.toEqual({
      name: 'Aster',
      description: 'Patient, precise, and intensely curious.',
      personality: '',
      scenario: '',
      first_mes: 'The observatory is usually quieter at this hour.',
      mes_example: '',
      creator_notes: 'Creator notes',
      tags: ['astronomy'],
      creator: 'Mira Prime',
      character_version: '2.1',
      extensions: { pygmalion: { id: 'pyg-42' } },
    })
  })
})
