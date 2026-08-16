import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DiscoveryCard } from '../types'
import { RisuRealmProvider } from './risuRealm'

const mocks = vi.hoisted(() => ({
  corsFetch: vi.fn(),
}))

vi.mock('../utils', () => ({
  corsFetch: mocks.corsFetch,
}))

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('RisuRealmProvider', () => {
  beforeEach(() => {
    mocks.corsFetch.mockReset()
    vi.restoreAllMocks()
  })

  it('requests SvelteKit data and resolves the devalue index graph into a card', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_712_345_678_901)
    // Risu serializes object properties and arrays as indexes into this shared value table.
    const devalueData = [
      null,
      [2],
      { id: 3, name: 4, authorname: 5, desc: 6, img: 7, tags: 8, download: 9 },
      'risu-9',
      'Lantern Keeper',
      'RealmScribe',
      'A guide through a city that dreams at night.',
      'lantern-keeper.webp',
      [10, 11],
      '1.25k',
      'dreams',
      'urban fantasy',
    ]
    mocks.corsFetch.mockResolvedValueOnce(jsonResponse({ nodes: [{}, { data: devalueData }] }))

    const provider = new RisuRealmProvider()
    const result = await provider.search(
      { query: 'lantern keeper', page: 2, sort: 'popular', nsfw: false },
      'character',
    )

    expect(mocks.corsFetch).toHaveBeenCalledWith(
      'https://realm.risuai.net/__data.json?sort=download&page=2&q=lantern+keeper&nsfw=false&_t=1712345678901',
      {
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
        },
      },
    )
    const raw = {
      id: 'risu-9',
      name: 'Lantern Keeper',
      authorname: 'RealmScribe',
      desc: 'A guide through a city that dreams at night.',
      img: 'lantern-keeper.webp',
      tags: ['dreams', 'urban fantasy'],
      download: '1.25k',
    }
    expect(result).toEqual({
      cards: [
        {
          id: 'risu-9',
          name: 'Lantern Keeper',
          creator: 'RealmScribe',
          description: 'A guide through a city that dreams at night.',
          avatarUrl: 'https://sv.risuai.xyz/resource/lantern-keeper.webp',
          imageUrl: 'https://realm.risuai.net/character/risu-9',
          tags: ['dreams', 'urban fantasy'],
          stats: { downloads: 1250 },
          source: 'risu_realm',
          type: 'character',
          nsfw: false,
          raw,
        },
      ],
      hasMore: false,
      nextPage: undefined,
    })
  })

  it('resolves its character page and downloads normalized JSON from devalue data', async () => {
    const card = {
      id: 'risu-9',
      name: 'Lantern Keeper',
      creator: 'RealmScribe',
      description: '',
      avatarUrl: '',
      tags: [],
      source: 'risu_realm',
      type: 'character',
      nsfw: false,
    } satisfies DiscoveryCard
    const devalueData = [
      null,
      {
        id: 2,
        name: 3,
        authorname: 4,
        desc: 5,
        tags: 6,
        personality: 9,
        scenario: 10,
        first_mes: 11,
        mes_example: 12,
        creator_notes: 13,
      },
      'risu-9',
      'Lantern Keeper',
      'RealmScribe',
      'A guide through a city that dreams at night.',
      [7, 8],
      'dreams',
      'urban fantasy',
      'Patient, watchful, and fond of riddles.',
      'The city has begun dreaming while awake.',
      'Keep your lantern close. The streets moved again.',
      '<START>\n{{char}}: Do you remember this alley?',
      'Keep the mystery gradual and atmospheric.',
    ]
    mocks.corsFetch.mockResolvedValueOnce(jsonResponse({ nodes: [{}, { data: devalueData }] }))

    const provider = new RisuRealmProvider()
    await expect(provider.getDownloadUrl(card)).resolves.toBe(
      'https://realm.risuai.net/character/risu-9',
    )
    const blob = await provider.downloadCard(card)

    expect(mocks.corsFetch).toHaveBeenCalledWith(
      'https://realm.risuai.net/character/risu-9/__data.json',
    )
    expect(blob.type).toBe('application/json')
    await expect(blob.text().then(JSON.parse)).resolves.toEqual({
      name: 'Lantern Keeper',
      description: 'A guide through a city that dreams at night.',
      personality: 'Patient, watchful, and fond of riddles.',
      scenario: 'The city has begun dreaming while awake.',
      first_mes: 'Keep your lantern close. The streets moved again.',
      mes_example: '<START>\n{{char}}: Do you remember this alley?',
      creator_notes: 'Keep the mystery gradual and atmospheric.',
      tags: ['dreams', 'urban fantasy'],
      creator: 'RealmScribe',
      character_version: '1.0',
      extensions: { risu_realm: { id: 'risu-9' } },
    })
  })
})
