import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DiscoveryCard } from '../types'

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

describe('QuillGenProvider', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.corsFetch.mockReset()
  })

  it('loads the browse cache once and maps, filters, and paginates its cards', async () => {
    const raw = {
      id: 'quill-7',
      public_id: 'public-fallback',
      name: 'Clockwork Gardener',
      creator: { name: 'Quillwright' },
      description: 'A caretaker for impossible mechanical flowers.',
      avatar_url: 'https://legacy.example/avatar.webp',
      image_url: 'https://quillgen.app/cards/quill-7.png',
      tags: ['clockwork', 'garden'],
      downloads: 88,
      nsfw: false,
    }
    mocks.corsFetch.mockResolvedValueOnce(jsonResponse({ cards: [raw] }))
    const { QuillGenProvider } = await import('./quillgen')
    const provider = new QuillGenProvider()

    const first = await provider.search(
      { query: 'GARDEN', page: 1, limit: 1, nsfw: false },
      'character',
    )
    const cached = await provider.search({ query: '', page: 1, limit: 5 }, 'scenario')

    expect(mocks.corsFetch).toHaveBeenCalledOnce()
    expect(mocks.corsFetch).toHaveBeenCalledWith(
      'https://quillgen.app/v1/public/api/browse/characters?limit=500',
      { headers: { Accept: 'application/json' } },
    )
    const expectedCard = {
      id: 'quill-7',
      name: 'Clockwork Gardener',
      creator: 'Quillwright',
      description: 'A caretaker for impossible mechanical flowers.',
      avatarUrl:
        'https://quillgen.app/v1/public/api/browse/characters/quill-7/avatar?size=300&format=webp',
      imageUrl:
        'https://quillgen.app/v1/public/api/browse/characters/quill-7/avatar?size=300&format=webp',
      tags: ['clockwork', 'garden'],
      stats: { downloads: 88 },
      source: 'quillgen',
      type: 'character',
      nsfw: false,
      raw,
    }
    expect(first).toEqual({ cards: [expectedCard], hasMore: false, nextPage: undefined })
    expect(cached).toEqual({ cards: [expectedCard], hasMore: false, nextPage: undefined })
  })

  it('uses the original card image URL as its downloadable artifact', async () => {
    const card = {
      id: 'quill-7',
      name: 'Clockwork Gardener',
      creator: 'Quillwright',
      description: '',
      avatarUrl: '',
      tags: [],
      source: 'quillgen',
      type: 'character',
      nsfw: false,
      raw: { image_url: 'https://quillgen.app/cards/quill-7.png' },
    } satisfies DiscoveryCard
    const pngBytes = new Uint8Array([137, 80, 78, 71])
    mocks.corsFetch.mockResolvedValueOnce(
      new Response(pngBytes, { status: 200, headers: { 'Content-Type': 'image/png' } }),
    )
    const { QuillGenProvider } = await import('./quillgen')
    const provider = new QuillGenProvider()

    await expect(provider.getDownloadUrl(card)).resolves.toBe(
      'https://quillgen.app/cards/quill-7.png',
    )
    const blob = await provider.downloadCard(card)

    expect(mocks.corsFetch).toHaveBeenCalledWith('https://quillgen.app/cards/quill-7.png')
    expect(blob.type).toBe('image/png')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(pngBytes)
  })
})
