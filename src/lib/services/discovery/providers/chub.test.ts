import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { corsFetchMock } = vi.hoisted(() => ({
  corsFetchMock: vi.fn(),
}))

vi.mock('../utils', () => ({
  corsFetch: corsFetchMock,
}))

import { ChubProvider } from './chub'

describe('ChubProvider', () => {
  beforeEach(() => {
    corsFetchMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('searches the character API with filters and maps its node contract', async () => {
    const node = {
      id: 'node-3',
      fullPath: 'maker/clockwork-guide',
      name: 'Clockwork Guide',
      tagline: 'A guide to the brass city.',
      topics: ['Adventure', 'Clockwork'],
      nChats: 96,
      starCount: 14,
      nsfw: false,
    }
    corsFetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: { nodes: [node] } }),
    } as unknown as Response)

    const provider = new ChubProvider()
    const result = await provider.search(
      {
        query: 'brass city',
        limit: 1,
        page: 3,
        sort: 'name',
        nsfw: false,
        tags: ['Adventure', 'Clockwork'],
      },
      'character',
    )

    const [requestUrl, init] = corsFetchMock.mock.calls[0] as [string, RequestInit]
    const url = new URL(requestUrl)
    expect(`${url.origin}${url.pathname}`).toBe('https://api.chub.ai/search')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      search: 'brass city',
      first: '1',
      page: '3',
      sort: 'name',
      asc: 'false',
      nsfw: 'false',
      nsfl: 'false',
      topics: 'Adventure,Clockwork',
    })
    expect(init).toEqual({ method: 'GET', headers: { Accept: 'application/json' } })
    expect(init.body).toBeUndefined()
    expect(result).toEqual({
      cards: [
        {
          id: 'maker/clockwork-guide',
          name: 'Clockwork Guide',
          creator: 'maker',
          description: 'A guide to the brass city.',
          avatarUrl: 'https://avatars.charhub.io/avatars/maker/clockwork-guide/chara_card_v2.png',
          imageUrl: 'https://avatars.charhub.io/avatars/maker/clockwork-guide/chara_card_v2.png',
          tags: ['Adventure', 'Clockwork'],
          stats: { downloads: 96, rating: 14 },
          source: 'chub',
          type: 'character',
          nsfw: false,
          raw: { ...node, pageUrl: 'https://chub.ai/characters/maker/clockwork-guide' },
        },
      ],
      hasMore: true,
      nextPage: 4,
    })
  })

  it('uses the lorebook gateway contract and maps lorebook identity', async () => {
    const node = {
      id: 'project-88',
      fullPath: 'lorebooks/archivist/brass-city',
      name: 'Brass City',
      description: 'Places and factions of the brass city.',
      topics: ['Setting', 'NSFW'],
      downloadCount: 12,
      starCount: 5,
    }
    corsFetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ nodes: [node] }),
    } as unknown as Response)

    const provider = new ChubProvider()
    const result = await provider.search({ query: 'brass', limit: 48 }, 'lorebook')

    const [requestUrl, init] = corsFetchMock.mock.calls[0] as [string, RequestInit]
    const url = new URL(requestUrl)
    expect(`${url.origin}${url.pathname}`).toBe('https://gateway.chub.ai/search')
    expect(url.searchParams.get('namespace')).toBe('lorebooks')
    expect(url.searchParams.get('include_forks')).toBe('true')
    expect(url.searchParams.get('search')).toBe('brass')
    expect(init).toEqual({ method: 'POST', headers: { Accept: 'application/json' } })
    expect(init.body).toBeUndefined()
    expect(result.cards[0]).toEqual({
      id: 'archivist/brass-city',
      name: 'Brass City',
      creator: 'archivist',
      description: 'Places and factions of the brass city.',
      avatarUrl: 'https://avatars.charhub.io/avatars/lorebooks/archivist/brass-city/avatar.webp',
      imageUrl: 'https://avatars.charhub.io/avatars/lorebooks/archivist/brass-city/avatar.webp',
      tags: ['Setting', 'NSFW'],
      stats: { downloads: 12, rating: 5 },
      source: 'chub',
      type: 'lorebook',
      nsfw: true,
      raw: { ...node, pageUrl: 'https://chub.ai/lorebooks/archivist/brass-city' },
    })
  })

  it('downloads character PNG data with the provider-specific accept header', async () => {
    const provider = new ChubProvider()
    const card = {
      id: 'maker/clockwork-guide',
      name: 'Clockwork Guide',
      creator: 'maker',
      description: 'A guide.',
      avatarUrl: '',
      tags: [],
      source: 'chub',
      type: 'character' as const,
      nsfw: false,
    }
    const downloaded = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
    corsFetchMock.mockResolvedValueOnce({
      ok: true,
      blob: vi.fn().mockResolvedValue(downloaded),
    } as unknown as Response)

    const expectedUrl = 'https://avatars.charhub.io/avatars/maker/clockwork-guide/chara_card_v2.png'
    expect(await provider.getDownloadUrl(card)).toBe(expectedUrl)
    const blob = await provider.downloadCard(card)

    expect(corsFetchMock).toHaveBeenCalledWith(expectedUrl, {
      headers: { Accept: 'image/png' },
    })
    expect(blob.type).toBe('image/png')
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([137, 80, 78, 71])
  })

  it('builds and downloads the raw SillyTavern lorebook URL', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.123456)
    const provider = new ChubProvider()
    const card = {
      id: 'archivist/brass-city',
      name: 'Brass City',
      creator: 'archivist',
      description: 'A setting book.',
      avatarUrl: '',
      tags: ['Setting'],
      source: 'chub',
      type: 'lorebook' as const,
      nsfw: false,
      raw: { id: 'project-88' },
    }
    const downloaded = new Blob(['{"entries":[]}'], { type: 'application/json' })
    corsFetchMock.mockResolvedValueOnce({
      ok: true,
      blob: vi.fn().mockResolvedValue(downloaded),
    } as unknown as Response)

    const expectedUrl =
      'https://gateway.chub.ai/api/v4/projects/project-88/repository/files/raw%252Fsillytavern_raw.json/raw?ref=main&response_type=blob&nocache=0.123456'
    expect(await provider.getDownloadUrl(card)).toBe(expectedUrl)
    const blob = await provider.downloadCard(card)

    expect(corsFetchMock).toHaveBeenCalledWith(expectedUrl, {
      headers: { Accept: 'application/json' },
    })
    expect(blob.type).toBe('application/json')
    expect(await blob.text()).toBe('{"entries":[]}')
  })
})
