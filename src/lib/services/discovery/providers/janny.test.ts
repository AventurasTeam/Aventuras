import { beforeEach, describe, expect, it, vi } from 'vitest'
import { METADATA_ONLY_CHARACTER_MIME } from '../types'
import type { DiscoveryCard } from '../types'

const { mockCorsFetch } = vi.hoisted(() => ({
  mockCorsFetch: vi.fn(),
}))

vi.mock('../utils', () => ({
  corsFetch: mockCorsFetch,
  GENERIC_ICON: 'generic-icon',
}))

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

function discoveryCard(): DiscoveryCard {
  return {
    id: 'character-42',
    name: 'Astra & Co.',
    creator: '',
    description: 'A spacefaring guide.',
    avatarUrl: 'https://image.jannyai.com/bot-avatars/astra.webp',
    imageUrl: 'https://image.jannyai.com/bot-avatars/astra.webp',
    tags: ['NSFW', 'Fantasy'],
    stats: { downloads: 73 },
    source: 'janny',
    type: 'character',
    nsfw: true,
    raw: {
      slug: 'astra-co',
      pageUrl: 'https://jannyai.com/characters/character-42_character-astra-co',
    },
  }
}

describe('JannyProvider', () => {
  beforeEach(() => {
    mockCorsFetch.mockReset()
    vi.resetModules()
  })

  it('searches Meilisearch with the discovered token and maps a scenario hit', async () => {
    const token = 'a'.repeat(64)
    mockCorsFetch
      .mockResolvedValueOnce(
        new Response('<script src="client-config.fixture.js"></script>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      )
      .mockResolvedValueOnce(new Response(`window.config = "${token}"`, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              hits: [
                {
                  id: 'character-42',
                  name: 'Astra & Co.',
                  description: '<p>A spacefaring&nbsp;guide &amp; pilot.</p>',
                  avatar: 'astra.webp',
                  tagIds: [53, 999],
                  isNsfw: true,
                  stats: { chatCount: 73 },
                },
              ],
            },
          ],
        }),
      )

    const { JannyProvider } = await import('./janny')
    const provider = new JannyProvider()
    const result = await provider.search(
      {
        query: 'space guide',
        page: 2,
        limit: 1,
        sort: 'name',
        nsfw: false,
      },
      'scenario',
    )

    expect(mockCorsFetch).toHaveBeenNthCalledWith(
      1,
      'https://jannyai.com/characters/search',
      expect.objectContaining({ headers: { Accept: 'text/html' } }),
    )
    expect(mockCorsFetch).toHaveBeenNthCalledWith(
      2,
      'https://jannyai.com/_astro/client-config.fixture.js',
    )

    const [searchUrl, searchInit] = mockCorsFetch.mock.calls[2] as [string, RequestInit]
    expect(searchUrl).toBe('https://search.jannyai.com/multi-search')
    expect(searchInit.method).toBe('POST')
    expect(searchInit.headers).toMatchObject({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: 'https://jannyai.com',
    })
    expect(JSON.parse(String(searchInit.body))).toEqual({
      queries: [
        expect.objectContaining({
          indexUid: 'janny-characters',
          q: 'space guide',
          hitsPerPage: 1,
          page: 2,
          sort: ['name:asc'],
          filter: ['totalToken <= 4101 AND totalToken >= 29', '(isNsfw = false)'],
        }),
      ],
    })

    expect(result).toEqual({
      cards: [
        expect.objectContaining({
          id: 'character-42',
          name: 'Astra & Co.',
          creator: '',
          description: 'A spacefaring guide & pilot.',
          avatarUrl: 'https://image.jannyai.com/bot-avatars/astra.webp',
          imageUrl: 'https://image.jannyai.com/bot-avatars/astra.webp',
          tags: ['NSFW', 'Fantasy', 'Tag 999'],
          stats: { downloads: 73 },
          source: 'janny',
          type: 'character',
          nsfw: true,
          raw: expect.objectContaining({
            id: 'character-42',
            slug: 'astra-co',
            pageUrl: 'https://jannyai.com/characters/character-42_character-astra-co',
          }),
        }),
      ],
      hasMore: true,
      nextPage: 3,
    })
  })

  it('uses the first-party download API and returns the downloaded card blob', async () => {
    const card = discoveryCard()
    mockCorsFetch
      .mockResolvedValueOnce(
        jsonResponse({ status: 'ok', downloadUrl: 'https://cdn.jannyai.com/cards/astra.png' }),
      )
      .mockResolvedValueOnce(
        new Response('png-card-payload', {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
      )

    const { JannyProvider } = await import('./janny')
    const provider = new JannyProvider()

    expect(await provider.getDownloadUrl(card)).toBe(
      'https://jannyai.com/characters/character-42_character-astra-co',
    )

    const blob = await provider.downloadCard(card)

    expect(mockCorsFetch).toHaveBeenNthCalledWith(
      1,
      'https://api.jannyai.com/api/v1/download',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Origin: 'https://jannyai.com',
        }),
        body: JSON.stringify({ characterId: 'character-42' }),
      }),
    )
    expect(mockCorsFetch).toHaveBeenNthCalledWith(2, 'https://cdn.jannyai.com/cards/astra.png')
    expect(blob.type).toBe('image/png')
    expect(await blob.text()).toBe('png-card-payload')
  })

  it.each([
    ['malformed', 'not a URL'],
    ['non-HTTPS', 'http://cdn.jannyai.com/cards/astra.png'],
    ['nonstandard port', 'https://cdn.jannyai.com:444/cards/astra.png'],
    ['lookalike host', 'https://cdn.jannyai.com.evil.example/cards/astra.png'],
    ['untrusted subdomain', 'https://evil.jannyai.com/cards/astra.png'],
  ])('rejects a %s download URL', async (_case, downloadUrl) => {
    mockCorsFetch.mockResolvedValueOnce(jsonResponse({ status: 'ok', downloadUrl }))

    const { JannyProvider } = await import('./janny')
    await expect(new JannyProvider().downloadCard(discoveryCard())).rejects.toThrow(
      'JannyAI did not return a character download',
    )
    expect(mockCorsFetch).toHaveBeenCalledOnce()
  })

  it('rejects a download payload without a usable URL', async () => {
    mockCorsFetch.mockResolvedValueOnce(jsonResponse({ status: 'error' }))

    const { JannyProvider } = await import('./janny')
    await expect(new JannyProvider().downloadCard(discoveryCard())).rejects.toThrow(
      'JannyAI did not return a character download',
    )
  })

  it('throws for non-403 download failures', async () => {
    mockCorsFetch.mockResolvedValueOnce(new Response('Unavailable', { status: 500 }))

    const { JannyProvider } = await import('./janny')
    await expect(new JannyProvider().downloadCard(discoveryCard())).rejects.toThrow(
      'Failed to fetch JannyAI character: 500',
    )
  })

  it('does not treat an unrelated 403 as a Cloudflare challenge', async () => {
    mockCorsFetch.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))

    const { JannyProvider } = await import('./janny')
    await expect(new JannyProvider().downloadCard(discoveryCard())).rejects.toThrow(
      'Failed to fetch JannyAI character: 403',
    )
  })

  it('returns an explicit metadata-only V2 card when Cloudflare blocks downloads', async () => {
    const card = discoveryCard()
    mockCorsFetch.mockResolvedValueOnce(
      new Response('Cloudflare challenge', {
        status: 403,
        headers: { Server: 'cloudflare', 'CF-Ray': 'fixture-ray' },
      }),
    )

    const { JannyProvider } = await import('./janny')
    const blob = await new JannyProvider().downloadCard(card)
    const payload = JSON.parse(await blob.text())

    expect(mockCorsFetch).toHaveBeenCalledWith(
      'https://api.jannyai.com/api/v1/download',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ characterId: 'character-42' }),
      }),
    )
    expect(blob.type).toBe(METADATA_ONLY_CHARACTER_MIME)
    expect(payload).toEqual({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: expect.objectContaining({
        name: 'Astra & Co.',
        description: 'A spacefaring guide.',
        scenario: '',
        creator_notes:
          'Imported from JannyAI search metadata only. Full card unavailable. https://jannyai.com/characters/character-42_character-astra-co',
        tags: ['NSFW', 'Fantasy'],
        extensions: {
          jannyai: {
            id: 'character-42',
            pageUrl: 'https://jannyai.com/characters/character-42_character-astra-co',
            metadataOnly: true,
          },
        },
      }),
    })
  })

  it('uses the metadata-only fallback when Cloudflare blocks the card CDN', async () => {
    mockCorsFetch
      .mockResolvedValueOnce(
        jsonResponse({ status: 'ok', downloadUrl: 'https://cdn.jannyai.com/cards/astra.png' }),
      )
      .mockResolvedValueOnce(
        new Response('Cloudflare challenge', {
          status: 403,
          headers: { 'CF-Mitigated': 'challenge' },
        }),
      )

    const { JannyProvider } = await import('./janny')
    const blob = await new JannyProvider().downloadCard(discoveryCard())

    expect(blob.type).toBe(METADATA_ONLY_CHARACTER_MIME)
    expect(JSON.parse(await blob.text()).data.extensions.jannyai.metadataOnly).toBe(true)
  })
})
