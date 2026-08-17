import { describe, expect, it, vi } from 'vitest'
import { DiscoveryService } from './index'
import type { DiscoveryProvider, SearchOptions } from './types'

function providerWithSearch(search: DiscoveryProvider['search']): DiscoveryProvider {
  return {
    id: 'fixture',
    name: 'Fixture',
    supports: ['character'],
    search,
    getDownloadUrl: vi.fn(),
    downloadCard: vi.fn(),
    getTags: vi.fn(),
  }
}

describe('DiscoveryService all-provider pagination', () => {
  it('preserves sensitivity, sorting, and tags when loading the next page', async () => {
    const search = vi
      .fn<DiscoveryProvider['search']>()
      .mockResolvedValueOnce({ cards: [], hasMore: true, nextPage: 7 })
      .mockResolvedValueOnce({ cards: [], hasMore: false })
    const service = new DiscoveryService([providerWithSearch(search)])
    const options: SearchOptions = {
      query: 'guide',
      page: 4,
      limit: 12,
      sort: 'new',
      nsfw: true,
      tags: ['Fantasy'],
    }

    await service.searchAll(options, 'character')
    await service.loadMoreAll('character', 24)

    expect(search).toHaveBeenNthCalledWith(1, { ...options, page: 1 }, 'character')
    expect(search).toHaveBeenNthCalledWith(
      2,
      {
        query: 'guide',
        tags: ['Fantasy'],
        sort: 'new',
        nsfw: true,
        page: 7,
        limit: 24,
      },
      'character',
    )
  })
})
