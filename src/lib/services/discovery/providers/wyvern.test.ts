import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WyvernProvider } from './wyvern'

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

describe('WyvernProvider', () => {
  beforeEach(() => {
    mocks.corsFetch.mockReset()
  })

  it('searches and downloads a character directly from the result payload', async () => {
    const raw = {
      id: 'wyv-char-1',
      name: 'Ash Cartographer',
      creator: { displayName: 'MapMaker', vanityUrl: 'map-fallback' },
      description: 'Maps roads that only appear after sunset.',
      avatar: 'https://cdn.wyvern.chat/ash.webp',
      tags: ['maps', 'fantasy'],
      rating: 'mature',
      statistics_record: { views: 400, likes: 37 },
      personality: 'Methodical and dryly funny.',
      scenario: 'A road has disappeared overnight.',
      first_mes: 'That road was here yesterday.',
      mes_example: '<START>\n{{char}}: Check the milestone again.',
      creator_notes: 'Designed for mystery stories.',
      pre_history_instructions: 'Keep discoveries internally consistent.',
      post_history_instructions: 'Advance one clue at a time.',
      alternate_greetings: ['You are late. The road is already moving.'],
    }
    mocks.corsFetch.mockResolvedValueOnce(jsonResponse({ results: [raw], hasMore: true, page: 3 }))

    const provider = new WyvernProvider()
    const result = await provider.search(
      {
        query: 'ash map',
        page: 3,
        limit: 12,
        sort: 'name',
        nsfw: false,
        tags: ['maps', 'fantasy'],
      },
      'character',
    )

    expect(mocks.corsFetch).toHaveBeenCalledWith(
      'https://api.wyvern.chat/exploreSearch/characters?q=ash+map&page=3&limit=12&sort=name&order=DESC&tags=maps%2Cfantasy&rating=none',
      { headers: { Accept: 'application/json' } },
    )
    expect(result).toEqual({
      cards: [
        {
          id: 'wyv-char-1',
          name: 'Ash Cartographer',
          creator: 'MapMaker',
          description: 'Maps roads that only appear after sunset.',
          avatarUrl: 'https://cdn.wyvern.chat/ash.webp',
          imageUrl: 'https://cdn.wyvern.chat/ash.webp',
          tags: ['maps', 'fantasy'],
          stats: { views: 400, rating: 37 },
          source: 'wyvern',
          type: 'character',
          nsfw: true,
          raw,
        },
      ],
      hasMore: true,
      nextPage: 4,
    })

    const card = result.cards[0]
    await expect(provider.getDownloadUrl(card)).resolves.toBe(
      'https://wyvern.chat/characters/wyv-char-1',
    )
    const blob = await provider.downloadCard(card)

    // Wyvern embeds complete card data in search results, so downloads require no second request.
    expect(mocks.corsFetch).toHaveBeenCalledOnce()
    expect(blob.type).toBe('application/json')
    await expect(blob.text().then(JSON.parse)).resolves.toEqual({
      name: 'Ash Cartographer',
      description: 'Maps roads that only appear after sunset.',
      personality: 'Methodical and dryly funny.',
      scenario: 'A road has disappeared overnight.',
      first_mes: 'That road was here yesterday.',
      mes_example: '<START>\n{{char}}: Check the milestone again.',
      creator_notes: 'Designed for mystery stories.',
      system_prompt: 'Keep discoveries internally consistent.',
      post_history_instructions: 'Advance one clue at a time.',
      alternate_greetings: ['You are late. The road is already moving.'],
      tags: ['maps', 'fantasy'],
      creator: 'MapMaker',
      character_version: '1.0',
      extensions: { wyvern: { id: 'wyv-char-1' } },
    })
  })

  it('searches and downloads a lorebook directly from the result payload', async () => {
    const raw = {
      _id: 'wyv-lore-3',
      name: 'The Glass Archipelago',
      creator: { vanityUrl: 'island-scribe' },
      description: 'Locations and customs of the mirrored islands.',
      photoURL: 'https://cdn.wyvern.chat/glass.webp',
      tags: ['setting', 'islands'],
      rating: 'none',
      statistics_record: { views: 90, likes: 12 },
      entries: [{ keys: ['Glassport'], content: 'A harbor built inside a crystal caldera.' }],
      scan_depth: 4,
      token_budget: 600,
      recursive_scanning: true,
    }
    mocks.corsFetch.mockResolvedValueOnce(jsonResponse({ results: [raw], hasMore: false, page: 1 }))

    const provider = new WyvernProvider()
    const result = await provider.search(
      { query: 'glass', page: 1, limit: 20, sort: 'new', nsfw: true },
      'lorebook',
    )

    expect(mocks.corsFetch).toHaveBeenCalledWith(
      'https://api.wyvern.chat/exploreSearch/lorebooks?q=glass&page=1&limit=20&sort=created_at&order=DESC',
      { headers: { Accept: 'application/json' } },
    )
    expect(result).toEqual({
      cards: [
        {
          id: 'wyv-lore-3',
          name: 'The Glass Archipelago',
          creator: 'island-scribe',
          description: 'Locations and customs of the mirrored islands.',
          avatarUrl: 'https://cdn.wyvern.chat/glass.webp',
          imageUrl: 'https://cdn.wyvern.chat/glass.webp',
          tags: ['setting', 'islands'],
          stats: { views: 90, rating: 12 },
          source: 'wyvern',
          type: 'lorebook',
          nsfw: false,
          raw,
        },
      ],
      hasMore: false,
      nextPage: undefined,
    })

    const card = result.cards[0]
    await expect(provider.getDownloadUrl(card)).resolves.toBe(
      'https://wyvern.chat/lorebooks/wyv-lore-3',
    )
    const blob = await provider.downloadCard(card)

    expect(mocks.corsFetch).toHaveBeenCalledOnce()
    expect(blob.type).toBe('application/json')
    await expect(blob.text().then(JSON.parse)).resolves.toEqual({
      name: 'The Glass Archipelago',
      description: 'Locations and customs of the mirrored islands.',
      entries: [{ keys: ['Glassport'], content: 'A harbor built inside a crystal caldera.' }],
      scan_depth: 4,
      token_budget: 600,
      recursive_scanning: true,
      extensions: { wyvern: { id: 'wyv-lore-3' } },
    })
  })
})
